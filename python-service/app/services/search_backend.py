"""Pluggable search backend: Elasticsearch if configured, else SQL LIKE fallback."""
import os
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from ..models import Document, OcrResult

ES_URL = os.environ.get("ELASTICSEARCH_URL", "").strip()
ES_INDEX = os.environ.get("ELASTICSEARCH_INDEX", "dms_documents")

try:
    if ES_URL:
        from elasticsearch import Elasticsearch
        _es = Elasticsearch(ES_URL)
    else:
        _es = None
except Exception:
    _es = None


def is_elastic_enabled() -> bool:
    return _es is not None


def index_document(doc: Document, ocr_text: str = "") -> None:
    if _es is None:
        return
    body = {
        "id": doc.id,
        "original_name": doc.original_name,
        "doc_type": doc.doc_type,
        "customer_cid": doc.customer_cid,
        "branch": doc.branch,
        "status": doc.status,
        "expiry_date": doc.expiry_date,
        "ocr_text": ocr_text,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }
    try:
        _es.index(index=ES_INDEX, id=doc.id, document=body)
    except Exception:
        pass


def search(db: Session, q: Optional[str], doc_type: Optional[str], branch: Optional[str],
           status: Optional[str], limit: int = 50) -> list[Document]:
    if _es and q:
        try:
            resp = _es.search(index=ES_INDEX, query={
                "bool": {
                    "must": [{"multi_match": {
                        "query": q,
                        "fields": ["original_name^2", "customer_cid^2", "doc_type", "ocr_text"],
                        "fuzziness": "AUTO",
                    }}],
                    "filter": [f for f in [
                        {"term": {"doc_type": doc_type}} if doc_type else None,
                        {"term": {"branch": branch}} if branch else None,
                        {"term": {"status": status}} if status else None,
                    ] if f],
                }
            }, size=limit)
            ids = [int(h["_id"]) for h in resp["hits"]["hits"]]
            if ids:
                return db.query(Document).filter(Document.id.in_(ids)).all()
        except Exception:
            pass  # fall through to SQL

    query = db.query(Document).outerjoin(OcrResult)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(
            Document.original_name.ilike(like),
            Document.customer_cid.ilike(like),
            Document.doc_type.ilike(like),
            OcrResult.text.ilike(like),
        ))
    if doc_type:
        query = query.filter(Document.doc_type == doc_type)
    if branch:
        query = query.filter(Document.branch == branch)
    if status:
        query = query.filter(Document.status == status)
    return query.order_by(Document.id.desc()).limit(limit).all()

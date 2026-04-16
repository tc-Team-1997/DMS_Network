from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document, OcrResult
from ..services.auth import require, Principal
from ..services import vector as vec

router = APIRouter(prefix="/api/v1/vector", tags=["vector"])


@router.get("/backend")
def backend():
    return {"backend": vec.backend_name()}


@router.post("/index/{doc_id}")
def index_doc(doc_id: int, db: Session = Depends(get_db),
              p: Principal = Depends(require("index"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    ocr = db.query(OcrResult).filter(OcrResult.document_id == doc_id).first()
    text = (ocr.text if ocr else "") or f"{doc.doc_type or ''} {doc.customer_cid or ''}"
    vec.upsert(doc_id, text)
    return {"document_id": doc_id, "indexed": True, "backend": vec.backend_name()}


@router.post("/reindex")
def reindex_all(db: Session = Depends(get_db),
                p: Principal = Depends(require("admin"))):
    count = 0
    for doc, ocr in db.query(Document, OcrResult).outerjoin(
        OcrResult, OcrResult.document_id == Document.id
    ).all():
        text = (ocr.text if ocr else "") or f"{doc.doc_type or ''} {doc.customer_cid or ''}"
        vec.upsert(doc.id, text)
        count += 1
    return {"reindexed": count, "backend": vec.backend_name()}


@router.get("/search")
def semantic_search(q: str = Query(..., description="Natural language query"),
                    top_k: int = 10,
                    db: Session = Depends(get_db),
                    p: Principal = Depends(require("view"))):
    hits = vec.search(q, top_k=top_k)
    # Hydrate with document metadata, tenant-scoped.
    out = []
    for h in hits:
        d = db.get(Document, h["document_id"])
        if not d or d.tenant != p.tenant:
            continue
        if ("doc_admin" not in p.roles and "auditor" not in p.roles
                and p.branch and d.branch and d.branch != p.branch):
            continue
        out.append({
            "document_id": d.id, "score": h["score"],
            "original_name": d.original_name, "doc_type": d.doc_type,
            "customer_cid": d.customer_cid, "status": d.status,
        })
    return {"query": q, "backend": vec.backend_name(), "hits": out}

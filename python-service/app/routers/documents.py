from typing import Optional, List
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document
from ..schemas import DocumentOut, DocumentUpdate
from ..services.auth import current_principal, require, Principal
from ..services.storage import save_bytes
from ..services.phash import compute_phash
from ..services.search_backend import index_document
from ..services.events import emit
from ..services.metrics import DOCS_UPLOADED
from ..services.crdt import stamp as crdt_stamp
from ..services.provenance import record as prov_record

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


@router.post("", response_model=DocumentOut)
async def upload_document(
    file: UploadFile = File(...),
    doc_type: Optional[str] = Form(None),
    customer_cid: Optional[str] = Form(None),
    branch: Optional[str] = Form(None),
    issue_date: Optional[str] = Form(None),
    expiry_date: Optional[str] = Form(None),
    uploaded_by: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    p: Principal = Depends(require("capture")),
):
    data = await file.read()
    stored_path, digest, size = save_bytes(data, file.filename or "file.bin")
    phash = compute_phash(stored_path)

    doc = Document(
        filename=stored_path,
        original_name=file.filename or "file.bin",
        mime_type=file.content_type,
        size_bytes=size,
        sha256=digest,
        phash=phash,
        doc_type=doc_type,
        customer_cid=customer_cid,
        branch=branch or p.branch,
        tenant=p.tenant,
        issue_date=issue_date,
        expiry_date=expiry_date,
        uploaded_by=uploaded_by or p.sub,
        status="captured",
        sync_clock=crdt_stamp(None),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    index_document(doc)
    emit("document.uploaded", id=doc.id, original_name=doc.original_name,
         doc_type=doc.doc_type, customer_cid=doc.customer_cid)
    DOCS_UPLOADED.labels(doc.tenant or "default", doc.doc_type or "unknown").inc()
    prov_record(db, doc.id, "created", actor=p.sub,
                payload={"doc_type": doc.doc_type, "size_bytes": doc.size_bytes,
                         "sha256": doc.sha256, "branch": doc.branch})
    return doc


def _scope(q, p: Principal):
    q = q.filter(Document.tenant == p.tenant)
    # Non-admins are restricted to their own branch (if set on the principal).
    if "doc_admin" not in p.roles and "auditor" not in p.roles and p.branch:
        q = q.filter(Document.branch == p.branch)
    return q


def _ensure_scope(doc: Document, p: Principal):
    if doc.tenant != p.tenant:
        raise HTTPException(404, "Document not found")
    if ("doc_admin" not in p.roles and "auditor" not in p.roles
            and p.branch and doc.branch and doc.branch != p.branch):
        raise HTTPException(403, "Out of branch scope")


@router.get("", response_model=List[DocumentOut])
def list_documents(
    customer_cid: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("view")),
):
    q = _scope(db.query(Document), p)
    if customer_cid:
        q = q.filter(Document.customer_cid == customer_cid)
    if doc_type:
        q = q.filter(Document.doc_type == doc_type)
    if status:
        q = q.filter(Document.status == status)
    return q.order_by(Document.id.desc()).offset(offset).limit(limit).all()


@router.get("/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: int, db: Session = Depends(get_db), p: Principal = Depends(require("view"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    _ensure_scope(doc, p)
    return doc


@router.patch("/{doc_id}", response_model=DocumentOut)
def update_document(doc_id: int, payload: DocumentUpdate, db: Session = Depends(get_db),
                    p: Principal = Depends(require("index"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    _ensure_scope(doc, p)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(doc, k, v)
    doc.sync_clock = crdt_stamp(doc.sync_clock)
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/{doc_id}/file")
def download_document(doc_id: int, db: Session = Depends(get_db), p: Principal = Depends(require("view"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    _ensure_scope(doc, p)
    return FileResponse(doc.filename, filename=doc.original_name, media_type=doc.mime_type or "application/octet-stream")


@router.delete("/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db), p: Principal = Depends(require("admin"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    _ensure_scope(doc, p)
    db.delete(doc)
    db.commit()
    return {"ok": True}

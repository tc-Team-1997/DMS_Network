from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document
from ..services.auth import require, Principal
from ..services.provenance import list_events, lineage, verify_chain

router = APIRouter(prefix="/api/v1/provenance", tags=["provenance"])


def _ensure(doc: Document, p: Principal):
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.tenant != p.tenant:
        raise HTTPException(404, "Document not found")


@router.get("/{doc_id}/events")
def events(doc_id: int, db: Session = Depends(get_db),
           p: Principal = Depends(require("audit_read"))):
    _ensure(db.get(Document, doc_id), p)
    return list_events(db, doc_id)


@router.get("/{doc_id}/lineage")
def graph(doc_id: int, db: Session = Depends(get_db),
          p: Principal = Depends(require("audit_read"))):
    _ensure(db.get(Document, doc_id), p)
    return lineage(db, doc_id)


@router.get("/{doc_id}/verify")
def verify(doc_id: int, db: Session = Depends(get_db),
           p: Principal = Depends(require("audit_read"))):
    _ensure(db.get(Document, doc_id), p)
    return verify_chain(db, doc_id)

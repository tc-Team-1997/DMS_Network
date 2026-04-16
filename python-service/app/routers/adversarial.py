from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document
from ..services.auth import require, Principal
from ..services.adversarial import detect
from ..services.events import emit

router = APIRouter(prefix="/api/v1/adversarial", tags=["adversarial"])


@router.get("/{doc_id}")
def scan(doc_id: int, db: Session = Depends(get_db),
         p: Principal = Depends(require("approve"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    r = detect(doc.filename)
    r["document_id"] = doc.id
    if r["band"] in ("high", "critical"):
        emit("adversarial.alert", document_id=doc.id, score=r["score"], band=r["band"])
    return r

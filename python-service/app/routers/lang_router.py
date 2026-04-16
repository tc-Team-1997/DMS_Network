from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document
from ..services.auth import require, Principal
from ..services.lang_router import route_and_ocr

router = APIRouter(prefix="/api/v1/ocr-route", tags=["ocr-router"])


@router.post("/{doc_id}")
def route(doc_id: int, db: Session = Depends(get_db),
          p: Principal = Depends(require("index"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    r = route_and_ocr(doc.filename)
    if r.get("error"):
        raise HTTPException(400, r["error"])
    return {"document_id": doc.id, **r}

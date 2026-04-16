from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document
from ..services.auth import require, Principal
from ..services.ocr_arabic import run_bilingual_ocr, extract_signature, has_arabic

router = APIRouter(prefix="/api/v1/ocr-ar", tags=["ocr-arabic"])


@router.get("/capabilities")
def caps(p: Principal = Depends(require("view"))):
    return {"arabic_trained_data": has_arabic()}


@router.post("/{doc_id}")
def bilingual(doc_id: int, db: Session = Depends(get_db),
              p: Principal = Depends(require("index"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return {"document_id": doc.id, **run_bilingual_ocr(doc.filename)}


@router.post("/{doc_id}/signature")
def signature(doc_id: int, db: Session = Depends(get_db),
              p: Principal = Depends(require("index"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    result = extract_signature(doc.filename)
    if not result.get("ok"):
        raise HTTPException(400, result.get("reason", "extraction failed"))
    return {"document_id": doc.id, **result}

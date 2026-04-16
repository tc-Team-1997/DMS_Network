import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document, OcrResult
from ..schemas import OcrOut
from ..security import require_api_key
from ..services.ocr import run_ocr
from ..services.search_backend import index_document
from ..services.metrics import OCR_CONFIDENCE
from ..services import vector as _vec

router = APIRouter(prefix="/api/v1/ocr", tags=["ocr"], dependencies=[Depends(require_api_key)])


@router.post("/{doc_id}", response_model=OcrOut)
def process_ocr(doc_id: int, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    result = run_ocr(doc.filename)
    ocr = doc.ocr or OcrResult(document_id=doc.id)
    ocr.text = result["text"]
    ocr.confidence = result["confidence"]
    ocr.fields_json = json.dumps(result["fields"])
    ocr.engine = result["engine"]
    if doc.ocr is None:
        db.add(ocr)
    doc.status = "indexed" if result["confidence"] >= 0.9 else "review"
    db.commit()
    db.refresh(ocr)
    index_document(doc, ocr.text or "")
    OCR_CONFIDENCE.observe(ocr.confidence or 0.0)
    try:
        _vec.upsert(doc.id, ocr.text or "")
    except Exception:
        pass
    return OcrOut(
        document_id=doc.id,
        text=ocr.text or "",
        confidence=ocr.confidence or 0.0,
        fields=json.loads(ocr.fields_json or "{}"),
    )


@router.get("/{doc_id}", response_model=OcrOut)
def get_ocr(doc_id: int, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc or not doc.ocr:
        raise HTTPException(404, "OCR result not found")
    return OcrOut(
        document_id=doc.id,
        text=doc.ocr.text or "",
        confidence=doc.ocr.confidence or 0.0,
        fields=json.loads(doc.ocr.fields_json or "{}"),
    )

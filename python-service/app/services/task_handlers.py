"""Registered background task handlers."""
import json
from .tasks import register
from ..db import SessionLocal
from ..models import Document, OcrResult
from .ocr import run_ocr
from .duplicates import find_duplicates
from .search_backend import index_document


@register("ocr.process")
def ocr_process(document_id: int) -> dict:
    db = SessionLocal()
    try:
        doc = db.get(Document, document_id)
        if not doc:
            return {"error": "not_found"}
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
        index_document(doc, ocr.text or "")
        return {"document_id": doc.id, "confidence": result["confidence"], "status": doc.status}
    finally:
        db.close()


@register("duplicates.scan")
def duplicates_scan(document_id: int) -> dict:
    db = SessionLocal()
    try:
        doc = db.get(Document, document_id)
        if not doc:
            return {"error": "not_found"}
        matches = find_duplicates(db, doc)
        return {"document_id": doc.id, "matches": len(matches)}
    finally:
        db.close()

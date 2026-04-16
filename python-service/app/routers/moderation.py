from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document, OcrResult
from ..services.auth import require, Principal
from ..services.moderation import scan_text, scan_image
from ..services.events import emit

router = APIRouter(prefix="/api/v1/moderation", tags=["moderation"])


class TextIn(BaseModel):
    text: str


@router.post("/text")
def moderate_text(body: TextIn, p: Principal = Depends(require("view"))):
    return scan_text(body.text)


@router.get("/{doc_id}")
def moderate_document(doc_id: int, db: Session = Depends(get_db),
                      p: Principal = Depends(require("approve"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    ocr = db.query(OcrResult).filter(OcrResult.document_id == doc.id).first()
    text = (ocr.text if ocr else "") or doc.original_name or ""
    result = scan_text(text)
    result["document_id"] = doc.id
    if result["band"] == "block":
        emit("moderation.flag", document_id=doc.id,
             score=result["score"], categories=[s["category"] for s in result["signals"]])
    return result

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document
from ..services.auth import require, Principal
from ..services.redaction import detect, redact_text, redact_pdf

router = APIRouter(prefix="/api/v1/redact", tags=["redaction"])


class TextIn(BaseModel):
    text: str


@router.post("/text")
def redact_text_api(body: TextIn, p: Principal = Depends(require("view"))):
    redacted, findings = redact_text(body.text)
    return {"redacted": redacted, "findings": findings, "count": len(findings)}


@router.post("/detect")
def detect_api(body: TextIn, p: Principal = Depends(require("view"))):
    return {"findings": detect(body.text)}


@router.post("/{doc_id}/pdf")
def redact_doc_pdf(doc_id: int, db: Session = Depends(get_db),
                   p: Principal = Depends(require("admin"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    result = redact_pdf(doc.filename)
    if not result.get("ok"):
        raise HTTPException(400, result.get("reason", "Redaction failed"))
    return {"document_id": doc.id, **result}

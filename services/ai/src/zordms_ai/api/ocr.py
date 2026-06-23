from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile

from zordms_ai.auth import require_auth
from zordms_ai.ocr.tesseract import ocr_text

# OCR endpoint also requires auth — document uploads must be authenticated (F-01).
ocr_router = APIRouter(dependencies=[Depends(require_auth)])


@ocr_router.post("/ocr")
async def ocr_endpoint(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    return {"engine": "tesseract", "text": ocr_text(raw)}

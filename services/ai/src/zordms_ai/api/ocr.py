from __future__ import annotations

from fastapi import APIRouter, File, UploadFile

from zordms_ai.ocr.tesseract import ocr_text

ocr_router = APIRouter()


@ocr_router.post("/ocr")
async def ocr_endpoint(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    return {"engine": "tesseract", "text": ocr_text(raw)}

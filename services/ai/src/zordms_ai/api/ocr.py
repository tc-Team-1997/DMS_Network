from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from zordms_ai.auth import require_auth
from zordms_ai.ocr.tesseract import DEFAULT_LANG, ocr_text_lang

# OCR endpoint also requires auth — document uploads must be authenticated (F-01).
ocr_router = APIRouter(dependencies=[Depends(require_auth)])


@ocr_router.post("/ocr")
async def ocr_endpoint(
    file: UploadFile = File(...),
    lang: str = Form(DEFAULT_LANG),
) -> dict:
    """
    OCR an uploaded image. `lang` defaults to Dzongkha+English ("dzo+eng");
    unavailable language packs degrade gracefully (see ocr_text_lang). The
    response reports the language actually used so callers can see when Dzongkha
    fell back to English.
    """
    raw = await file.read()
    text, used = ocr_text_lang(raw, lang)
    return {"engine": "tesseract", "text": text, "lang": used}

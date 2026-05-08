"""Vision-language OCR — routes images through a VL model (Qwen2.5-VL,
Llava, etc) via Ollama, bypassing Tesseract entirely.

Used as a fallback when the Tesseract path yields garbage (low mean
confidence, poor contrast, complex layout). The public surface matches
`ocr.py`'s `OcrResult`, so the downstream pipeline (classify → extract →
embed) is unchanged.

Enable with:
    DOCBRAIN_VISION_OCR=qwen2.5vl:7b        # or llava:13b / llava:7b / minicpm-v
    DOCBRAIN_VISION_OCR_THRESHOLD=70        # fall back if Tesseract mean_conf < 70 (default)

The VL model is called with a strict extraction prompt that asks for
verbatim text, preserving structure and numbers. No summarisation.
"""
from __future__ import annotations

import base64
import io
import logging
import os
from dataclasses import dataclass
from typing import List, Optional

from .llm import OLLAMA_HOST
from .ocr import OcrPage, OcrResult, _detect_languages

log = logging.getLogger(__name__)

VISION_MODEL = os.environ.get("DOCBRAIN_VISION_OCR", "").strip()
VISION_THRESHOLD = float(os.environ.get("DOCBRAIN_VISION_OCR_THRESHOLD", "70"))

_VISION_SYSTEM = (
    "You are an OCR engine. Your only job is to transcribe the text you see "
    "in the provided image. Preserve every visible character: names, "
    "numbers, dates, IDs, addresses, field labels. Do NOT summarise, "
    "interpret, translate, or omit content. If a region is unreadable, "
    "skip it silently. Return the transcribed text only, with line breaks "
    "matching the image layout."
)


def vision_available() -> bool:
    return bool(VISION_MODEL)


def _vision_call(image_bytes: bytes) -> str:
    """Single VL pass over one image. Returns the raw transcription."""
    import ollama
    client = ollama.Client(host=OLLAMA_HOST)
    b64 = base64.b64encode(image_bytes).decode("ascii")
    try:
        resp = client.chat(
            model=VISION_MODEL,
            messages=[
                {"role": "system", "content": _VISION_SYSTEM},
                {
                    "role": "user",
                    "content": "Transcribe every visible character in this image, verbatim.",
                    "images": [b64],
                },
            ],
            options={"temperature": 0.0},
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("vision ocr call failed: %s", exc)
        return ""
    # Newer ollama-python (>= 0.4) returns a `ChatResponse` pydantic object.
    # Older versions return a plain dict. Accept both so we don't silently
    # drop content when the SDK upgrades under us.
    msg = resp.get("message") if isinstance(resp, dict) else getattr(resp, "message", None)
    if msg is None:
        return ""
    content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", "")
    return str(content or "").strip()


def _vision_image(data: bytes, page: int = 1) -> OcrPage:
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    text = _vision_call(data)
    # VL confidence is implicit; if the model returned content we call it 95%,
    # else 0. Downstream confidence gates then behave sensibly.
    conf = 95.0 if text else 0.0
    return OcrPage(
        page=page, text=text, mean_confidence=conf,
        width=img.width, height=img.height,
    )


def _vision_pdf(data: bytes) -> List[OcrPage]:
    """Rasterise each PDF page and run the VL model on each raster.
    Re-uses the pdf2image pipeline from ocr.py so the dependency footprint
    doesn't grow."""
    from pdf2image import convert_from_bytes
    images = convert_from_bytes(
        data,
        dpi=200,
        poppler_path=os.environ.get("POPPLER_PATH") or None,
    )
    pages: List[OcrPage] = []
    for i, img in enumerate(images, start=1):
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        pages.append(_vision_image(buf.getvalue(), page=i))
    return pages


def vision_ocr_document(data: bytes, mime_type: str) -> Optional[OcrResult]:
    """Entry point. Returns None when the vision model isn't configured."""
    if not vision_available():
        return None
    if not data:
        return OcrResult(pages=[], full_text="", languages=[], mean_confidence=0.0)

    if mime_type == "application/pdf":
        pages = _vision_pdf(data)
    elif mime_type.startswith("image/"):
        pages = [_vision_image(data)]
    else:
        # Vision path is only useful for images / rasterised pages.
        return None

    full_text = "\n\n".join(p.text for p in pages if p.text).strip()
    mean_conf = (sum(p.mean_confidence for p in pages) / len(pages)) if pages else 0.0
    return OcrResult(
        pages=pages,
        full_text=full_text,
        languages=_detect_languages(full_text),
        mean_confidence=round(mean_conf, 2),
    )


def choose_best(tesseract: OcrResult, vision: Optional[OcrResult]) -> tuple[OcrResult, str]:
    """Pick the better of (tesseract, vision) and tag it with the backend name.

    Rules:
      1. If vision produced nothing, keep tesseract.
      2. If tesseract's mean_confidence >= threshold AND it has substantive
         text (≥ 120 chars), keep it.
      3. Otherwise prefer the vision result when it has *any* text — the VL
         model's implicit 95% is more reliable on low-conf scans than a
         20%-confidence Tesseract splatter.
    """
    ttext = (tesseract.full_text or "").strip()
    if vision is None or not (vision.full_text or "").strip():
        return tesseract, "tesseract"
    if tesseract.mean_confidence >= VISION_THRESHOLD and len(ttext) >= 120:
        return tesseract, "tesseract"
    return vision, VISION_MODEL

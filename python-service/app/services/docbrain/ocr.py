"""Page-level OCR via Tesseract (+ pdf2image for PDFs).

Output is structured (page index, text, confidence, word-level bboxes optional)
so downstream consumers (classifier, NER, layout reasoning) can trace any
inference back to a specific region of the source document.
"""
from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass, field
from typing import List

import pytesseract
from PIL import Image

log = logging.getLogger(__name__)


@dataclass
class OcrPage:
    page: int
    text: str
    mean_confidence: float   # 0..100
    width: int               # px
    height: int              # px


@dataclass
class OcrResult:
    pages:         List[OcrPage]
    full_text:     str
    languages:     List[str]
    mean_confidence: float


def _lang_config() -> str:
    """
    Tesseract language pack selector. Always include English + Arabic in
    banking-KYC contexts (NBE, Gulf). Extend per tenant config later.
    """
    return os.environ.get("OCR_LANGS", "eng")


def _detect_languages(text: str) -> List[str]:
    """Lightweight language tag — OCR output, not a full langdet."""
    if any("\u0600" <= c <= "\u06FF" for c in text):
        return ["ara", "eng"]
    return ["eng"]


def _ocr_image(data: bytes, page: int = 1) -> OcrPage:
    img = Image.open(io.BytesIO(data))
    # pytesseract `image_to_data` gives us confidence per word; avg them.
    try:
        data_dict = pytesseract.image_to_data(
            img, lang=_lang_config(), output_type=pytesseract.Output.DICT,
        )
    except pytesseract.TesseractNotFoundError:
        log.error("tesseract binary not found; ensure TESSERACT_CMD is set")
        raise
    confs = [int(c) for c in data_dict["conf"] if c != "-1"]
    mean_conf = (sum(confs) / len(confs)) if confs else 0.0
    text = pytesseract.image_to_string(img, lang=_lang_config()).strip()
    return OcrPage(
        page=page, text=text, mean_confidence=float(mean_conf),
        width=img.width, height=img.height,
    )


def _ocr_pdf(data: bytes) -> List[OcrPage]:
    """Raster every page, OCR each. Rasterisation dependency lives here only."""
    from pdf2image import convert_from_bytes
    images = convert_from_bytes(
        data,
        dpi=200,
        poppler_path=os.environ.get("POPPLER_PATH") or None,
    )
    out: List[OcrPage] = []
    for i, img in enumerate(images, start=1):
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out.append(_ocr_image(buf.getvalue(), page=i))
    return out


def ocr_document(data: bytes, mime_type: str) -> OcrResult:
    """Top-level entry. Routes by mime_type; returns a structured result."""
    if not data:
        return OcrResult(pages=[], full_text="", languages=[], mean_confidence=0.0)
    if mime_type == "application/pdf":
        pages = _ocr_pdf(data)
    elif mime_type.startswith("image/"):
        pages = [_ocr_image(data)]
    else:
        # Plain text / docx fall back to utf-8 treatment. DOCX would use
        # python-docx; skipped here for footprint.
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            text = ""
        pages = [OcrPage(page=1, text=text, mean_confidence=100.0,
                         width=0, height=0)]

    full_text = "\n\n".join(p.text for p in pages if p.text).strip()
    mean_conf = (sum(p.mean_confidence for p in pages) / len(pages)) if pages else 0.0
    return OcrResult(
        pages=pages,
        full_text=full_text,
        languages=_detect_languages(full_text),
        mean_confidence=round(mean_conf, 2),
    )

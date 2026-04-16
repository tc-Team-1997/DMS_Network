import json
import re
from pathlib import Path
from typing import Tuple
from ..config import settings

try:
    import pytesseract
    from PIL import Image
    if settings.TESSERACT_CMD:
        pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD
except Exception:
    pytesseract = None

try:
    from pdf2image import convert_from_path
except Exception:
    convert_from_path = None


FIELD_PATTERNS = {
    "passport_no": re.compile(r"\b([A-Z]\d{7,9})\b"),
    "national_id": re.compile(r"\b(\d{14})\b"),
    "dob": re.compile(r"\b(\d{2}[/-]\d{2}[/-]\d{4})\b"),
    "expiry": re.compile(r"(?:EXP|Expiry|Expires)[:\s]+(\d{2}[/-]\d{2}[/-]\d{4})", re.I),
    "mrz": re.compile(r"(P<[A-Z]{3}[A-Z<]{5,})"),
}


def _image_text(path: Path) -> Tuple[str, float]:
    if pytesseract is None:
        return ("", 0.0)
    with Image.open(path) as im:
        data = pytesseract.image_to_data(im, output_type=pytesseract.Output.DICT)
        text = pytesseract.image_to_string(im)
    confs = [int(c) for c in data.get("conf", []) if str(c).lstrip("-").isdigit() and int(c) >= 0]
    avg_conf = (sum(confs) / len(confs) / 100.0) if confs else 0.0
    return text, avg_conf


def _pdf_text(path: Path) -> Tuple[str, float]:
    if convert_from_path is None or pytesseract is None:
        return ("", 0.0)
    kwargs = {}
    if settings.POPPLER_PATH:
        kwargs["poppler_path"] = settings.POPPLER_PATH
    pages = convert_from_path(str(path), dpi=200, **kwargs)
    texts, confs = [], []
    for im in pages:
        data = pytesseract.image_to_data(im, output_type=pytesseract.Output.DICT)
        texts.append(pytesseract.image_to_string(im))
        for c in data.get("conf", []):
            if str(c).lstrip("-").isdigit() and int(c) >= 0:
                confs.append(int(c))
    avg_conf = (sum(confs) / len(confs) / 100.0) if confs else 0.0
    return "\n".join(texts), avg_conf


def extract_fields(text: str) -> dict:
    out = {}
    for k, pat in FIELD_PATTERNS.items():
        m = pat.search(text)
        if m:
            out[k] = m.group(1)
    return out


def run_ocr(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        return {"text": "", "confidence": 0.0, "fields": {}, "engine": "tesseract"}
    ext = p.suffix.lower()
    if ext == ".pdf":
        text, conf = _pdf_text(p)
    elif ext in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}:
        text, conf = _image_text(p)
    else:
        text, conf = "", 0.0
    return {
        "text": text,
        "confidence": round(conf, 4),
        "fields": extract_fields(text),
        "engine": "tesseract",
    }

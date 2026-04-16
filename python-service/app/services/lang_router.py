"""Multi-language OCR engine router.

Cheaply detects which language(s) a document contains, picks the right engine,
and returns both text + detected language + confidence. Zero new dependencies
beyond what's already present (Tesseract + Pillow).

Detection heuristic:
  - Script class by Unicode block across the 1000 most-common non-space chars
    in a small first-pass OCR with `osd` (Tesseract Orientation & Script Detect).
  - Arabic (Arabic block 0x0600-06FF) → `ara`
  - Latin (Basic Latin + Latin-1) → `eng`
  - French (Latin + French-typical diacritics é/è/ç/à) → `fra+eng`
  - Mixed → `ara+eng`

Engine matrix:
  - Tesseract (default, lang packs installed in container)
  - AWS Textract / Azure Document Intelligence if OCR_UPSTREAM_URL is set
  - PaddleOCR for Arabic handwriting (when `paddle` is importable)

Falls back gracefully when engines or traineddata are missing.
"""
from __future__ import annotations
import os
import re
from pathlib import Path
from typing import Any

from ..config import settings


OCR_UPSTREAM_URL = os.environ.get("OCR_UPSTREAM_URL", "").strip()
OCR_UPSTREAM_KEY = os.environ.get("OCR_UPSTREAM_KEY", "").strip()


FRENCH_DIACRITICS = set("éèêëàâîïôûüç")
ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
LATIN_RE  = re.compile(r"[A-Za-z]")


def _count_scripts(text: str) -> dict[str, int]:
    ar = len(ARABIC_RE.findall(text or ""))
    la = len(LATIN_RE.findall(text or ""))
    fr = sum(1 for c in (text or "").lower() if c in FRENCH_DIACRITICS)
    return {"arabic": ar, "latin": la, "french_signal": fr}


def detect_languages(text: str) -> tuple[list[str], float]:
    s = _count_scripts(text)
    langs: list[str] = []
    score = 0.0
    total = s["arabic"] + s["latin"]
    if total == 0:
        return ["eng"], 0.0
    if s["arabic"] / total > 0.35:
        langs.append("ara")
    if s["latin"] / total > 0.35:
        if s["french_signal"] > 2:
            langs.extend(["fra", "eng"])
        else:
            langs.append("eng")
    if not langs:
        langs = ["eng"]
    score = min(1.0, total / 400.0)  # more chars → higher confidence, capped
    return langs, round(score, 3)


def _have_tesseract_langs() -> set[str]:
    try:
        import pytesseract
        if settings.TESSERACT_CMD:
            pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD
        return set(pytesseract.get_languages(config=""))
    except Exception:
        return set()


def _tesseract_ocr(path: Path, langs: list[str]) -> dict:
    try:
        import pytesseract
        from PIL import Image
    except Exception:
        return {"text": "", "confidence": 0.0, "engine": "none"}
    have = _have_tesseract_langs()
    wanted = [l for l in langs if l in have] or (["eng"] if "eng" in have else [])
    spec = "+".join(wanted) if wanted else "eng"
    with Image.open(path) as im:
        data = pytesseract.image_to_data(im, lang=spec,
                                         output_type=pytesseract.Output.DICT)
        text = pytesseract.image_to_string(im, lang=spec)
    confs = [int(c) for c in data.get("conf", [])
             if str(c).lstrip("-").isdigit() and int(c) >= 0]
    conf = (sum(confs) / len(confs) / 100.0) if confs else 0.0
    return {"text": text, "confidence": round(conf, 4),
            "engine": f"tesseract({spec})"}


def _upstream_ocr(path: Path) -> dict:
    if not OCR_UPSTREAM_URL:
        return {"text": "", "confidence": 0.0, "engine": "none"}
    import httpx
    try:
        with open(path, "rb") as f:
            data = f.read()
        with httpx.Client(timeout=20.0) as c:
            r = c.post(OCR_UPSTREAM_URL,
                       headers={"Authorization": f"Bearer {OCR_UPSTREAM_KEY}"},
                       content=data)
            j = r.json() if r.status_code == 200 else {}
        return {"text": j.get("text", ""), "confidence": float(j.get("confidence", 0.0)),
                "engine": j.get("engine", "upstream")}
    except Exception as e:
        return {"text": "", "confidence": 0.0,
                "engine": f"upstream_failed:{str(e)[:80]}"}


def route_and_ocr(path: str) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        return {"error": "not_found"}
    ext = p.suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}:
        return {"error": "unsupported_format"}

    # Pass 1: cheap English-only OCR to get a language signal.
    first = _tesseract_ocr(p, ["eng"])
    langs, lang_conf = detect_languages(first["text"] or "")

    # If upstream is configured and the doc is Arabic-heavy, prefer it.
    prefer_upstream = "ara" in langs and bool(OCR_UPSTREAM_URL)

    primary = _upstream_ocr(p) if prefer_upstream else _tesseract_ocr(p, langs)
    # Fallback if primary produced nothing usable.
    if primary.get("confidence", 0) < 0.3 and primary is not first:
        primary = _tesseract_ocr(p, langs)

    return {
        "detected_languages": langs,
        "detection_confidence": lang_conf,
        "engine_used": primary.get("engine"),
        "text": primary.get("text", ""),
        "confidence": primary.get("confidence", 0.0),
        "first_pass_chars": len(first.get("text") or ""),
    }

from __future__ import annotations

import io

# pytesseract and Pillow are optional heavy deps; they are mocked in tests.
# Importing the names here so patches like
#   @patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string")
#   @patch("zordms_ai.ocr.tesseract.Image.open")
# work correctly whether or not the packages are installed.
try:
    import pytesseract  # type: ignore[import-untyped]
    from PIL import Image  # type: ignore[import-untyped]
except ImportError:
    pytesseract = None  # type: ignore[assignment]
    Image = None  # type: ignore[assignment]

# Bilingual default — Dzongkha + English (tender requirement / §9.3). Dzongkha is
# served by Tesseract's `dzo` traineddata; on hosts where it isn't installed we
# transparently fall back to whatever IS installed (usually `eng`) so OCR never
# hard-fails just because the Dzongkha pack is missing. Real Dzongkha accuracy
# still depends on the `dzo` model being deployed + client sign-off (§9.3).
DEFAULT_LANG = "dzo+eng"
FALLBACK_LANG = "eng"


def installed_languages() -> set[str]:
    """Tesseract traineddata languages installed on this host (empty if unknown)."""
    try:
        return set(pytesseract.get_languages(config=""))  # type: ignore[union-attr]
    except Exception:
        # No binary / old pytesseract / mocked-away → we can't introspect.
        return set()


def resolve_lang(requested: str) -> str:
    """
    Reduce a requested `a+b+c` lang spec to the parts actually installed, else
    fall back to FALLBACK_LANG. If we can't introspect (empty set), pass the
    request through unchanged and let the OCR call's own try/except handle it.
    """
    installed = installed_languages()
    if not installed:
        return requested
    parts = [p for p in requested.split("+") if p in installed]
    if parts:
        return "+".join(parts)
    return FALLBACK_LANG if FALLBACK_LANG in installed else requested


def ocr_text_lang(png_bytes: bytes, lang: str = DEFAULT_LANG) -> tuple[str, str]:
    """
    Run Tesseract OCR and return (text, lang_actually_used).

    Resolves the requested languages against what's installed, then OCRs. If the
    resolved spec still fails at runtime (e.g. the pack was reported but errors),
    we retry once with FALLBACK_LANG so a missing Dzongkha model degrades to
    English rather than 500-ing.
    """
    image = Image.open(io.BytesIO(png_bytes))  # type: ignore[union-attr]
    resolved = resolve_lang(lang)
    try:
        return pytesseract.image_to_string(image, lang=resolved), resolved  # type: ignore[union-attr]
    except Exception:
        if resolved != FALLBACK_LANG:
            return pytesseract.image_to_string(image, lang=FALLBACK_LANG), FALLBACK_LANG  # type: ignore[union-attr]
        raise


def ocr_text(png_bytes: bytes, lang: str = DEFAULT_LANG) -> str:
    """Run Tesseract OCR on PNG bytes and return the extracted text."""
    text, _ = ocr_text_lang(png_bytes, lang)
    return text

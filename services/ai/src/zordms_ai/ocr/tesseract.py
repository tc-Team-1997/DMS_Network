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


def ocr_text(png_bytes: bytes, lang: str = "eng") -> str:
    """Run Tesseract OCR on PNG bytes and return the extracted text."""
    image = Image.open(io.BytesIO(png_bytes))  # type: ignore[union-attr]
    return pytesseract.image_to_string(image, lang=lang)  # type: ignore[union-attr]

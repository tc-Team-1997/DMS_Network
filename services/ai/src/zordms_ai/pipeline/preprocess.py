from __future__ import annotations

import base64
import io

# pdf2image and Pillow are optional heavy deps; they are mocked in tests.
# Importing the names here so patches like
#   @patch("zordms_ai.pipeline.preprocess.convert_from_bytes")
#   @patch("zordms_ai.pipeline.preprocess._encode_png")
# work correctly whether or not the packages are installed.
try:
    from pdf2image import convert_from_bytes  # type: ignore[import-untyped]
    from PIL import Image  # type: ignore[import-untyped]
except ImportError:
    convert_from_bytes = None  # type: ignore[assignment]
    Image = None  # type: ignore[assignment]


def _encode_png(image: object) -> bytes:
    """Encode a Pillow Image to PNG bytes."""
    buf = io.BytesIO()
    image.save(buf, format="PNG")  # type: ignore[union-attr]
    return buf.getvalue()


def _reencode_image_to_png(raw: bytes) -> bytes:
    """Re-encode raw image bytes to PNG via Pillow."""
    image = Image.open(io.BytesIO(raw)).convert("RGB")  # type: ignore[union-attr]
    return _encode_png(image)


def to_page_images(raw: bytes, content_type: str) -> list[bytes]:
    """Convert raw file bytes to a list of PNG page images."""
    if content_type == "application/pdf":
        pages = convert_from_bytes(raw, dpi=300)  # type: ignore[misc]
        return [_encode_png(p) for p in pages]
    return [_reencode_image_to_png(raw)]


def b64_png(png_bytes: bytes) -> str:
    """Base64-encode PNG bytes for the vLLM data-URI."""
    return base64.b64encode(png_bytes).decode("ascii")

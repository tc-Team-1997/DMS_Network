import base64
from unittest.mock import MagicMock, patch

from zordms_ai.pipeline.preprocess import b64_png, to_page_images


def test_b64_png_roundtrip():
    assert base64.b64decode(b64_png(b"abc")) == b"abc"


@patch("zordms_ai.pipeline.preprocess._encode_png", return_value=b"PNGBYTES")
@patch("zordms_ai.pipeline.preprocess.convert_from_bytes")
def test_pdf_produces_one_png_per_page(mock_convert, _mock_encode):
    mock_convert.return_value = [MagicMock(), MagicMock()]  # two pages
    pages = to_page_images(b"%PDF-1.7 fake", "application/pdf")
    assert pages == [b"PNGBYTES", b"PNGBYTES"]
    mock_convert.assert_called_once()
    assert mock_convert.call_args.kwargs["dpi"] == 300


@patch("zordms_ai.pipeline.preprocess._reencode_image_to_png", return_value=b"IMGPNG")
def test_image_produces_single_png(_mock_reencode):
    pages = to_page_images(b"\x89PNG fake", "image/png")
    assert pages == [b"IMGPNG"]

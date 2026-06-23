import io
from unittest.mock import patch

from fastapi.testclient import TestClient

from zordms_ai.app import create_app
from zordms_ai.ocr.tesseract import ocr_text
from zordms_ai.settings import Settings


@patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string", return_value="HELLO BoB")
@patch("zordms_ai.ocr.tesseract.Image.open")
def test_ocr_text_calls_tesseract(mock_open, _mock_str):
    assert ocr_text(b"\x89PNG", lang="eng") == "HELLO BoB"
    mock_open.assert_called_once()


@patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string", return_value="SCANNED")
@patch("zordms_ai.ocr.tesseract.Image.open")
def test_ocr_endpoint_returns_text(_mock_open, _mock_str):
    app = create_app(Settings(database_url="sqlite+pysqlite:///:memory:"))
    client = TestClient(app)
    res = client.post("/ocr", files={"file": ("x.png", io.BytesIO(b"\x89PNG"), "image/png")})
    assert res.status_code == 200
    body = res.json()
    assert body["engine"] == "tesseract"
    assert body["text"] == "SCANNED"

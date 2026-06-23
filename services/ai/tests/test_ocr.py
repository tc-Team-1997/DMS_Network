"""Tests for /ocr endpoint — auth-aware."""
import io
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.ocr.tesseract import ocr_text
from zordms_ai.settings import Settings


def _auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token()}"}


@patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string", return_value="HELLO BoB")
@patch("zordms_ai.ocr.tesseract.Image.open")
def test_ocr_text_calls_tesseract(mock_open, _mock_str):
    assert ocr_text(b"\x89PNG", lang="eng") == "HELLO BoB"
    mock_open.assert_called_once()


def test_ocr_endpoint_requires_auth():
    """Unauthenticated request must return 401 (F-01)."""
    app = create_app(Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret=TEST_JWT_SECRET,
    ))
    client = TestClient(app)
    res = client.post("/ocr", files={"file": ("x.png", io.BytesIO(b"\x89PNG"), "image/png")})
    assert res.status_code == 401


@patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string", return_value="SCANNED")
@patch("zordms_ai.ocr.tesseract.Image.open")
def test_ocr_endpoint_returns_text(_mock_open, _mock_str):
    app = create_app(Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret=TEST_JWT_SECRET,
    ))
    client = TestClient(app)
    res = client.post(
        "/ocr",
        files={"file": ("x.png", io.BytesIO(b"\x89PNG"), "image/png")},
        headers=_auth(),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["engine"] == "tesseract"
    assert body["text"] == "SCANNED"

"""Tests for /ocr endpoint — auth-aware."""
import io
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.ocr.tesseract import DEFAULT_LANG, ocr_text, ocr_text_lang, resolve_lang
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


# ── Dzongkha (§9.3) ──────────────────────────────────────────────────────────

def test_default_lang_is_dzongkha_plus_english():
    assert DEFAULT_LANG == "dzo+eng"


@patch("zordms_ai.ocr.tesseract.pytesseract.get_languages", return_value=["dzo", "eng", "osd"])
def test_resolve_keeps_dzo_when_installed(_mock_langs):
    assert resolve_lang("dzo+eng") == "dzo+eng"


@patch("zordms_ai.ocr.tesseract.pytesseract.get_languages", return_value=["eng", "osd"])
def test_resolve_falls_back_to_eng_when_dzo_missing(_mock_langs):
    assert resolve_lang("dzo+eng") == "eng"


@patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string", return_value="ཇོང་ཁ")
@patch("zordms_ai.ocr.tesseract.Image.open")
@patch("zordms_ai.ocr.tesseract.pytesseract.get_languages", return_value=["dzo", "eng"])
def test_ocr_uses_dzongkha_when_installed(_langs, _open, mock_str):
    text, used = ocr_text_lang(b"\x89PNG")  # default dzo+eng
    assert used == "dzo+eng"
    assert text == "ཇོང་ཁ"
    assert mock_str.call_args.kwargs["lang"] == "dzo+eng"


@patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string", return_value="ENG ONLY")
@patch("zordms_ai.ocr.tesseract.Image.open")
@patch("zordms_ai.ocr.tesseract.pytesseract.get_languages", return_value=["eng", "osd"])
def test_ocr_degrades_to_english_when_dzo_missing(_langs, _open, mock_str):
    text, used = ocr_text_lang(b"\x89PNG", "dzo+eng")
    assert used == "eng"
    assert text == "ENG ONLY"
    assert mock_str.call_args.kwargs["lang"] == "eng"


@patch("zordms_ai.ocr.tesseract.Image.open")
@patch("zordms_ai.ocr.tesseract.pytesseract.get_languages", return_value=[])  # can't introspect
def test_ocr_runtime_failure_retries_english(_langs, _open):
    # First call (dzo+eng) raises, retry on eng succeeds.
    with patch(
        "zordms_ai.ocr.tesseract.pytesseract.image_to_string",
        side_effect=[Exception("Failed loading language 'dzo'"), "RECOVERED"],
    ) as mock_str:
        text, used = ocr_text_lang(b"\x89PNG", "dzo+eng")
    assert text == "RECOVERED"
    assert used == "eng"
    assert mock_str.call_count == 2


@patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string", return_value="HELLO")
@patch("zordms_ai.ocr.tesseract.Image.open")
@patch("zordms_ai.ocr.tesseract.pytesseract.get_languages", return_value=["dzo", "eng"])
def test_ocr_endpoint_reports_lang(_langs, _open, _str):
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
    assert body["lang"] == "dzo+eng"
    assert body["text"] == "HELLO"

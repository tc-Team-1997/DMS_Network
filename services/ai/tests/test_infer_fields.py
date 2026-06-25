"""Tests for POST /idp/infer-fields — AI sample-based field detection.

The vision client and preprocess are mocked; no Ollama model is needed.
"""
import io
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.classify.field_inference import FieldInferer, parse_fields
from zordms_ai.settings import Settings


class FakeVisionClient:
    """Returns a canned model reply (whatever was configured)."""

    def __init__(self, reply=None, exc: Exception | None = None):
        self._reply = reply
        self._exc = exc

    async def chat_json(self, *, model, system, user_text, image_b64, json_schema):
        if self._exc is not None:
            raise self._exc
        return self._reply


def _client(vision_client) -> TestClient:
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret=TEST_JWT_SECRET,
        )
    )
    # Swap in our fake inferer using the test vision client
    app.state.field_inferer = FieldInferer(vision_client, model="qwen2.5vl")
    return app and TestClient(app)


def _auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token()}"}


def _png():
    return ("sample.png", io.BytesIO(b"\x89PNG"), "image/png")


# --- auth ---------------------------------------------------------------

def test_infer_fields_requires_auth():
    res = _client(FakeVisionClient(reply={"fields": []})).post(
        "/idp/infer-fields", files={"file": _png()}
    )
    assert res.status_code == 401


# --- happy path ---------------------------------------------------------

@patch("zordms_ai.api.idp.to_page_images", return_value=[b"FAKEPNG"])
def test_infer_fields_returns_parsed_list(_mock_preproc):
    reply = {
        "fields": [
            {"name": "invoice_number", "label": "Invoice Number", "type": "string",
             "mandatory": True, "sample_value": "INV-1001"},
            {"name": "invoice_date", "label": "Invoice Date", "type": "date",
             "mandatory": True, "sample_value": "2026-01-15"},
            {"name": "total_amount", "label": "Total Amount", "type": "number",
             "mandatory": False, "sample_value": "1250.00"},
        ]
    }
    res = _client(FakeVisionClient(reply=reply)).post(
        "/idp/infer-fields",
        files={"file": _png()},
        data={"doc_type_hint": "invoice"},
        headers=_auth(),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["degraded"] is False
    assert body["doc_type_hint"] == "invoice"
    names = [f["name"] for f in body["fields"]]
    assert names == ["invoice_number", "invoice_date", "total_amount"]
    first = body["fields"][0]
    assert set(first.keys()) == {"name", "label", "type", "mandatory", "sample_value"}
    assert first["type"] == "string"
    assert first["mandatory"] is True


@patch("zordms_ai.api.idp.to_page_images", return_value=[b"FAKEPNG"])
def test_infer_fields_parses_free_text_array(_mock_preproc):
    """Model wraps the JSON array in prose / fences — must still parse."""
    reply = (
        "Sure! Here are the fields:\n```json\n"
        '[{"name":"PassportNo","label":"Passport No","type":"text",'
        '"mandatory":"yes","sample_value":"A1234567"}]\n```\nHope that helps.'
    )
    res = _client(FakeVisionClient(reply=reply)).post(
        "/idp/infer-fields",
        files={"file": _png()},
        headers=_auth(),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["degraded"] is False
    f = body["fields"][0]
    assert f["name"] == "passport_no"  # snake_cased
    assert f["type"] == "string"        # "text" normalised
    assert f["mandatory"] is True        # "yes" coerced


# --- dedupe -------------------------------------------------------------

@patch("zordms_ai.api.idp.to_page_images", return_value=[b"FAKEPNG"])
def test_infer_fields_dedupes(_mock_preproc):
    reply = {
        "fields": [
            {"name": "full_name", "label": "Full Name", "type": "string",
             "mandatory": True, "sample_value": "Sonam"},
            {"name": "Full Name", "label": "Full Name", "type": "string",
             "mandatory": True, "sample_value": "Sonam"},  # dup after snake_case
            {"name": "dob", "label": "DOB", "type": "date",
             "mandatory": False, "sample_value": "1990-04-12"},
        ]
    }
    res = _client(FakeVisionClient(reply=reply)).post(
        "/idp/infer-fields",
        files={"file": _png()},
        headers=_auth(),
    )
    assert res.status_code == 200
    names = [f["name"] for f in res.json()["fields"]]
    assert names == ["full_name", "dob"]


# --- degraded (backend down) -------------------------------------------

@patch("zordms_ai.api.idp.to_page_images", return_value=[b"FAKEPNG"])
def test_infer_fields_degraded_when_backend_down(_mock_preproc):
    res = _client(FakeVisionClient(exc=RuntimeError("ollama unreachable"))).post(
        "/idp/infer-fields",
        files={"file": _png()},
        headers=_auth(),
    )
    assert res.status_code == 200  # graceful, not 500
    body = res.json()
    assert body["degraded"] is True
    assert body["fields"] == []
    assert body["note"]


# --- unit: parse_fields caps & normalises -------------------------------

def test_parse_fields_caps_to_max():
    from zordms_ai.classify.field_inference import MAX_FIELDS

    big = {"fields": [
        {"name": f"field_{i}", "label": f"F{i}", "type": "string",
         "mandatory": False, "sample_value": str(i)}
        for i in range(MAX_FIELDS + 10)
    ]}
    fields = parse_fields(big)
    assert len(fields) == MAX_FIELDS

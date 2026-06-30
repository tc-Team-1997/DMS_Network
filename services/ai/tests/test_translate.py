"""§5.8 Translation — LLM-backed with graceful fallback."""
import pytest
from fastapi.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.settings import Settings
from zordms_ai.translate.translator import translate


class _S:
    ollama_text_model = "granite3.3:8b"
    ollama_base_url = "http://localhost:11434"
    ollama_timeout_s = 5.0


@pytest.mark.asyncio
async def test_translate_uses_injected_completion():
    async def fake(text, *, system, settings):
        assert "Dzongkha" in system  # target name flows into the prompt
        return "  འབྲུག་རྒྱལ་ཁབ་  "

    out = await translate("Kingdom of Bhutan", "dzo", settings=_S(), complete=fake)
    assert out["degraded"] is False
    assert out["translated"] == "འབྲུག་རྒྱལ་ཁབ་"  # trimmed
    assert out["engine"].startswith("ollama:")
    assert out["target"] == "dzo"


@pytest.mark.asyncio
async def test_translate_empty_text_is_noop():
    out = await translate("   ", "en", settings=_S(), complete=None)
    assert out["translated"] == ""
    assert out["engine"] == "noop"
    assert out["degraded"] is False


@pytest.mark.asyncio
async def test_translate_degrades_on_model_error():
    async def boom(_text, *, system, settings):
        raise RuntimeError("ollama down")

    out = await translate("hello", "dzo", settings=_S(), complete=boom)
    assert out["degraded"] is True
    assert out["translated"] == "hello"  # original returned unchanged
    assert out["engine"] == "degraded"


@pytest.mark.asyncio
async def test_translate_degrades_on_empty_output():
    async def empty(_text, *, system, settings):
        return "   "

    out = await translate("hello", "en", settings=_S(), complete=empty)
    assert out["degraded"] is True
    assert out["translated"] == "hello"


# ── Endpoint ─────────────────────────────────────────────────────────────────

def _app():
    return create_app(Settings(database_url="sqlite+pysqlite:///:memory:", jwt_secret=TEST_JWT_SECRET))


def test_endpoint_requires_auth():
    res = TestClient(_app()).post("/idp/translate", json={"text": "hi", "target": "dzo"})
    assert res.status_code == 401


def test_endpoint_rejects_unsupported_target():
    res = TestClient(_app()).post(
        "/idp/translate",
        json={"text": "hi", "target": "klingon"},
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert res.status_code == 400


def test_endpoint_returns_200_and_shape():
    # Environment-agnostic: with a local model it translates; without one it
    # degrades to the original text. Either way: 200 + well-formed response.
    # (The fallback behaviour itself is covered by the injected-completion tests.)
    res = TestClient(_app()).post(
        "/idp/translate",
        json={"text": "Kingdom of Bhutan", "target": "dzo"},
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["target"] == "dzo"
    assert isinstance(body["translated"], str) and body["translated"]
    assert isinstance(body["degraded"], bool)

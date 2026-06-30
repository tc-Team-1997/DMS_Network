"""§SC-01 AI-assisted dashboard insights — narration + fallback."""
import pytest
from fastapi.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.insights.narrator import generate_insights, summarize_metrics
from zordms_ai.settings import Settings


class _S:
    ollama_text_model = "granite3.3:8b"
    ollama_base_url = "http://localhost:11434"
    ollama_timeout_s = 5.0


def test_summary_highlights_risks():
    s = summarize_metrics({"totalDocuments": 1200, "pendingReview": 8, "expiringSoon": 15})
    assert "1200 total documents" in s
    assert "await review" in s
    assert "expiring soon" in s


def test_summary_handles_empty():
    assert "No metrics" in summarize_metrics({})


@pytest.mark.asyncio
async def test_generate_uses_llm_when_available():
    async def fake(prompt, *, system, settings):
        return "  Volume is steady; 8 reviews pending and 15 docs expiring soon.  "
    out = await generate_insights({"pendingReview": 8, "expiringSoon": 15}, settings=_S(), complete=fake)
    assert out["degraded"] is False
    assert out["narrative"].startswith("Volume is steady")


@pytest.mark.asyncio
async def test_generate_falls_back_to_baseline_on_error():
    async def boom(_p, *, system, settings):
        raise RuntimeError("no model")
    out = await generate_insights({"totalDocuments": 5, "pendingReview": 2}, settings=_S(), complete=boom)
    assert out["degraded"] is True
    assert "2 pending review" in out["narrative"]  # baseline returned


def test_endpoint_requires_auth():
    app = create_app(Settings(database_url="sqlite+pysqlite:///:memory:", jwt_secret=TEST_JWT_SECRET))
    res = TestClient(app).post("/idp/insights", json={"metrics": {}})
    assert res.status_code == 401


def test_endpoint_returns_narrative():
    app = create_app(Settings(database_url="sqlite+pysqlite:///:memory:", jwt_secret=TEST_JWT_SECRET))
    res = TestClient(app).post(
        "/idp/insights",
        json={"metrics": {"totalDocuments": 1200, "pendingReview": 8}},
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["narrative"], str) and body["narrative"]
    assert isinstance(body["degraded"], bool)

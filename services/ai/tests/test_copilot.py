"""Tests for POST /idp/copilot/ask — mocks search HTTP and LLM client; no network."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.copilot.intent import detect_intent
from zordms_ai.copilot.search_client import SearchHit, SearchResult
from zordms_ai.settings import Settings


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _make_settings(**kwargs) -> Settings:
    defaults = dict(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret=TEST_JWT_SECRET,
        search_url="http://fake-search:4004",
        anthropic_api_key="",
        openai_api_key="",
    )
    defaults.update(kwargs)
    return Settings(**defaults)  # type: ignore[arg-type]


def _client(settings: Settings | None = None) -> TestClient:
    s = settings or _make_settings()
    app = create_app(s)
    return TestClient(app)


def _auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token()}"}


_FAKE_HITS = [
    SearchHit(doc_id="DOC-001", title="KYC Submission Form", snippet="Customer KYC submitted on 2025-01-10."),
    SearchHit(doc_id="DOC-002", title="Loan Application", snippet="Loan application for 500,000 BTN."),
]

_SEARCH_OK = SearchResult(hits=_FAKE_HITS, degraded=False)
_SEARCH_DEGRADED = SearchResult(hits=[], degraded=True, error="Connection refused")


# ──────────────────────────────────────────────────────────────────────────────
# Auth enforcement
# ──────────────────────────────────────────────────────────────────────────────

def test_copilot_ask_requires_auth():
    """401 returned when no Authorization header is provided."""
    res = _client().post("/idp/copilot/ask", json={"question": "hello"})
    assert res.status_code == 401


def test_copilot_ask_invalid_token():
    """401 returned for a tampered token."""
    res = _client().post(
        "/idp/copilot/ask",
        json={"question": "hello"},
        headers={"Authorization": "Bearer not.a.real.token"},
    )
    assert res.status_code == 401


# ──────────────────────────────────────────────────────────────────────────────
# Fallback — grounded-extractive (no LLM key)
# ──────────────────────────────────────────────────────────────────────────────

@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
def test_copilot_returns_citations(mock_retrieve):
    """Citations returned from retrieved search hits."""
    mock_retrieve.return_value = _SEARCH_OK

    res = _client().post(
        "/idp/copilot/ask",
        json={"question": "List all KYC submissions"},
        headers=_auth(),
    )
    assert res.status_code == 200
    body = res.json()
    assert "answer" in body
    assert len(body["citations"]) == 2
    assert body["citations"][0]["doc_id"] == "DOC-001"
    assert body["citations"][0]["title"] == "KYC Submission Form"
    assert "snippet" in body["citations"][0]


@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
def test_copilot_fallback_answer_composed_from_snippets(mock_retrieve):
    """Grounded-extractive fallback composes answer text from snippets."""
    mock_retrieve.return_value = _SEARCH_OK

    res = _client().post(
        "/idp/copilot/ask",
        json={"question": "What are the loan applications?"},
        headers=_auth(),
    )
    assert res.status_code == 200
    body = res.json()
    # Fallback answer should mention at least one of the doc titles
    assert "KYC Submission Form" in body["answer"] or "Loan Application" in body["answer"]
    assert body["model"] == "grounded-extractive-fallback"


@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
def test_copilot_degraded_search_returns_empty_citations(mock_retrieve):
    """When search is degraded, citations list is empty and answer explains."""
    mock_retrieve.return_value = _SEARCH_DEGRADED

    res = _client().post(
        "/idp/copilot/ask",
        json={"question": "Find expiring documents"},
        headers=_auth(),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["citations"] == []
    assert body["model"] == "grounded-extractive-fallback"
    # The answer should mention that no docs were retrieved
    assert "could not find" in body["answer"].lower() or "unreachable" in body["answer"].lower() or "no documents" in body["answer"].lower()


# ──────────────────────────────────────────────────────────────────────────────
# Intent detection
# ──────────────────────────────────────────────────────────────────────────────

@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
def test_copilot_intent_search(mock_retrieve):
    mock_retrieve.return_value = _SEARCH_OK
    res = _client().post(
        "/idp/copilot/ask",
        json={"question": "Find all documents expiring in the next 30 days"},
        headers=_auth(),
    )
    assert res.status_code == 200
    assert res.json()["intent"] == "search"


@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
def test_copilot_intent_summarize(mock_retrieve):
    mock_retrieve.return_value = _SEARCH_OK
    res = _client().post(
        "/idp/copilot/ask",
        json={"question": "Summarise the latest KYC submissions"},
        headers=_auth(),
    )
    assert res.status_code == 200
    assert res.json()["intent"] == "summarize"


@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
def test_copilot_intent_navigate(mock_retrieve):
    mock_retrieve.return_value = _SEARCH_OK
    res = _client().post(
        "/idp/copilot/ask",
        json={"question": "How do I navigate to the compliance dashboard?"},
        headers=_auth(),
    )
    assert res.status_code == 200
    assert res.json()["intent"] == "navigate"


@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
def test_copilot_intent_qa(mock_retrieve):
    mock_retrieve.return_value = _SEARCH_OK
    res = _client().post(
        "/idp/copilot/ask",
        json={"question": "What is the retention policy for board resolutions?"},
        headers=_auth(),
    )
    assert res.status_code == 200
    assert res.json()["intent"] == "qa"


# ──────────────────────────────────────────────────────────────────────────────
# Search token passthrough
# ──────────────────────────────────────────────────────────────────────────────

@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
def test_copilot_passes_auth_token_to_search(mock_retrieve):
    """The caller's Bearer token is forwarded to the search service."""
    mock_retrieve.return_value = _SEARCH_OK
    token = make_token()

    _client().post(
        "/idp/copilot/ask",
        json={"question": "Summarize board resolutions"},
        headers={"Authorization": f"Bearer {token}"},
    )

    mock_retrieve.assert_awaited_once()
    _, kwargs = mock_retrieve.call_args
    assert kwargs.get("auth_token") == token


# ──────────────────────────────────────────────────────────────────────────────
# LLM mock — Anthropic
# ──────────────────────────────────────────────────────────────────────────────

@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
@patch("zordms_ai.copilot.llm_client._anthropic_answer", new_callable=AsyncMock)
def test_copilot_uses_anthropic_when_key_set(mock_llm, mock_retrieve):
    """When anthropic_api_key is set, _anthropic_answer is called."""
    mock_retrieve.return_value = _SEARCH_OK
    mock_llm.return_value = ("Mocked Anthropic answer.", "anthropic/claude-haiku-4-5")

    settings = _make_settings(anthropic_api_key="sk-ant-fake")
    res = _client(settings).post(
        "/idp/copilot/ask",
        json={"question": "What is the CID policy?"},
        headers=_auth(),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["model"] == "anthropic/claude-haiku-4-5"
    assert body["answer"] == "Mocked Anthropic answer."


# ──────────────────────────────────────────────────────────────────────────────
# Conversation history passed through
# ──────────────────────────────────────────────────────────────────────────────

@patch("zordms_ai.api.copilot.retrieve", new_callable=AsyncMock)
def test_copilot_accepts_history(mock_retrieve):
    """Endpoint accepts and processes conversation history without error."""
    mock_retrieve.return_value = _SEARCH_OK
    history = [
        {"role": "user", "content": "List all KYC docs"},
        {"role": "assistant", "content": "There are 5 KYC docs."},
    ]
    res = _client().post(
        "/idp/copilot/ask",
        json={"question": "Which ones are missing a CID?", "history": history},
        headers=_auth(),
    )
    assert res.status_code == 200
    assert "answer" in res.json()


# ──────────────────────────────────────────────────────────────────────────────
# Intent unit tests (no HTTP)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("question,expected", [
    ("Find all expiring documents", "search"),
    ("Which records are missing a CID?", "search"),
    ("Summarise the latest audit reports", "summarize"),
    ("Give me an overview of the board resolutions", "summarize"),
    ("How do I navigate to the review queue page?", "navigate"),
    ("Open the compliance dashboard screen", "navigate"),
    ("What is the KYC retention policy?", "qa"),
    ("Compare retention policies", "qa"),
])
def test_detect_intent(question: str, expected: str):
    assert detect_intent(question) == expected

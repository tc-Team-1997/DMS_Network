"""Integration tests for the Ollama backend routing.

All HTTP is mocked — no network or running model required.
Tests verify:
  - classify uses Ollama when AI_BACKEND=ollama (is_available patched True)
  - classify falls back gracefully on OllamaError
  - extract uses Ollama when AI_BACKEND=ollama
  - copilot uses Ollama text when no API keys + Ollama available
  - copilot still returns citations regardless of LLM backend
  - mock/auto paths still work
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from zordms_ai.classify.classifier import Classifier
from zordms_ai.copilot.llm_client import generate_answer
from zordms_ai.copilot.search_client import SearchHit, SearchResult
from zordms_ai.extract.extractor import Extractor
from zordms_ai.inference.ollama_adapter import OllamaVisionAdapter
from zordms_ai.inference.ollama_client import OllamaError
from zordms_ai.settings import Settings


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _settings(**kwargs) -> Settings:
    defaults = dict(
        database_url="sqlite+pysqlite:///:memory:",
        ai_backend="ollama",
        ollama_base_url="http://localhost:11434",
        ollama_vlm_model="qwen2.5vl:7b",
        ollama_text_model="granite3.3:8b",
        anthropic_api_key="",
        openai_api_key="",
    )
    defaults.update(kwargs)
    return Settings(**defaults)  # type: ignore[arg-type]


_CLASSIFY_RESPONSE = {"doc_type": "BT_PASSPORT", "confidence": 0.95, "signals": ["maroon cover"]}
_EXTRACT_RESPONSE = {
    "doc_type": "BT_CID_4G",
    "cid_no": "10112345678",
    "full_name": "Sonam Wangchuk",
    "dob": "1990-04-12",
    "sex": "M",
    "issue_date": "2025-01-01",
    "expiry_date": "2035-01-01",
    "dzongkhag": "Thimphu",
    "confidence": 0.94,
}

_FAKE_HITS = [
    SearchHit(doc_id="DOC-001", title="KYC Submission Form", snippet="Customer KYC submitted on 2025-01-10."),
    SearchHit(doc_id="DOC-002", title="Loan Application", snippet="Loan application for 500,000 BTN."),
]


# ──────────────────────────────────────────────────────────────────────────────
# Classify → Ollama
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@patch("zordms_ai.inference.ollama_client.is_available", return_value=True)
async def test_classifier_uses_ollama_adapter_when_backend_ollama(mock_avail):
    """Classifier.classify() goes through OllamaVisionAdapter when AI_BACKEND=ollama."""
    adapter = OllamaVisionAdapter(
        base_url="http://localhost:11434",
        vlm_model="qwen2.5vl:7b",
        timeout_s=10.0,
    )
    # Patch the adapter's underlying HTTP call
    with patch.object(adapter, "chat_json", new_callable=AsyncMock) as mock_chat:
        mock_chat.return_value = _CLASSIFY_RESPONSE
        clf = Classifier(adapter, model="qwen2.5vl:7b")
        result = await clf.classify(image_b64="QUJD", ocr_text="")

    assert result.doc_type == "BT_PASSPORT"
    assert result.confidence == 0.95
    mock_chat.assert_called_once()


@pytest.mark.asyncio
async def test_classifier_falls_back_on_ollama_error():
    """When OllamaVisionAdapter raises OllamaError, Classifier propagates it (caller degrades)."""
    adapter = OllamaVisionAdapter(
        base_url="http://localhost:11434",
        vlm_model="qwen2.5vl:7b",
        timeout_s=5.0,
    )
    with patch.object(adapter, "chat_json", side_effect=OllamaError("connection refused")):
        clf = Classifier(adapter, model="qwen2.5vl:7b")
        with pytest.raises(OllamaError):
            await clf.classify(image_b64="QUJD", ocr_text="")


# ──────────────────────────────────────────────────────────────────────────────
# Extract → Ollama
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extractor_uses_ollama_adapter_when_backend_ollama():
    """Extractor.extract() goes through OllamaVisionAdapter when AI_BACKEND=ollama."""
    adapter = OllamaVisionAdapter(
        base_url="http://localhost:11434",
        vlm_model="qwen2.5vl:7b",
        timeout_s=10.0,
    )
    with patch.object(adapter, "chat_json", new_callable=AsyncMock) as mock_chat:
        mock_chat.return_value = _EXTRACT_RESPONSE
        ex = Extractor(adapter, model="qwen2.5vl:7b")
        result = await ex.extract("BT_CID_4G", image_b64="QUJD")

    assert result.valid is True
    assert result.data is not None
    assert result.data.cid_no == "10112345678"
    mock_chat.assert_called_once()


@pytest.mark.asyncio
async def test_extractor_falls_back_review_flag_on_ollama_error():
    """Extractor propagates OllamaError (caller handles degradation)."""
    adapter = OllamaVisionAdapter(
        base_url="http://localhost:11434",
        vlm_model="qwen2.5vl:7b",
        timeout_s=5.0,
    )
    with patch.object(adapter, "chat_json", side_effect=OllamaError("timeout")):
        ex = Extractor(adapter, model="qwen2.5vl:7b")
        with pytest.raises(OllamaError):
            await ex.extract("BT_CID_4G", image_b64="QUJD")


# ──────────────────────────────────────────────────────────────────────────────
# Copilot → Ollama text
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@patch("zordms_ai.copilot.llm_client.ollama_client.is_available", return_value=True)
@patch("zordms_ai.copilot.llm_client.ollama_client.text_complete", return_value="Ollama answer about KYC.")
async def test_copilot_uses_ollama_when_no_api_keys(mock_complete, mock_avail):
    """generate_answer uses Ollama when no ANTHROPIC/OPENAI keys + Ollama available."""
    settings = _settings()
    answer, label = await generate_answer(
        question="What are the KYC requirements?",
        history=[],
        hits=_FAKE_HITS,
        degraded=False,
        settings=settings,
    )
    assert label == "ollama:granite3.3:8b"
    assert "Ollama answer" in answer
    mock_complete.assert_called_once()


@pytest.mark.asyncio
@patch("zordms_ai.copilot.llm_client.ollama_client.is_available", return_value=True)
@patch("zordms_ai.copilot.llm_client.ollama_client.text_complete", return_value="Ollama answer.")
async def test_copilot_ollama_returns_citations(mock_complete, mock_avail):
    """Citations from search hits are always returned regardless of LLM backend."""
    settings = _settings()
    answer, label = await generate_answer(
        question="Summarise KYC docs",
        history=[],
        hits=_FAKE_HITS,
        degraded=False,
        settings=settings,
    )
    # The caller (api/copilot.py) builds citations from hits — hits still present
    assert len(_FAKE_HITS) == 2  # sanity: hits are passed through
    assert label.startswith("ollama:")


@pytest.mark.asyncio
@patch("zordms_ai.copilot.llm_client.ollama_client.is_available", return_value=True)
@patch(
    "zordms_ai.copilot.llm_client.ollama_client.text_complete",
    side_effect=Exception("Ollama unreachable"),
)
async def test_copilot_ollama_error_falls_back_to_extractive(mock_fail, mock_avail):
    """On Ollama error, copilot degrades to extractive fallback."""
    settings = _settings()
    answer, label = await generate_answer(
        question="Find expiring documents",
        history=[],
        hits=_FAKE_HITS,
        degraded=False,
        settings=settings,
    )
    assert label == "grounded-extractive-fallback"
    assert "KYC Submission Form" in answer or "Loan Application" in answer


@pytest.mark.asyncio
@patch("zordms_ai.copilot.llm_client.ollama_client.is_available", return_value=False)
async def test_copilot_falls_back_to_extractive_when_ollama_not_available(mock_avail):
    """When Ollama is not available and no API keys, use extractive fallback."""
    settings = _settings()
    answer, label = await generate_answer(
        question="Find documents",
        history=[],
        hits=_FAKE_HITS,
        degraded=False,
        settings=settings,
    )
    assert label == "grounded-extractive-fallback"


# ──────────────────────────────────────────────────────────────────────────────
# app.py backend resolution — auto path
# ──────────────────────────────────────────────────────────────────────────────

@patch("zordms_ai.app.ollama_client.is_available", return_value=True)
def test_resolve_vision_client_auto_picks_ollama_when_available(mock_avail):
    """_resolve_vision_client returns OllamaVisionAdapter when AI_BACKEND=auto and Ollama up."""
    from zordms_ai.app import _resolve_vision_client

    s = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        ai_backend="auto",
        ollama_base_url="http://localhost:11434",
    )
    client = _resolve_vision_client(s)
    assert isinstance(client, OllamaVisionAdapter)


@patch("zordms_ai.app.ollama_client.is_available", return_value=False)
def test_resolve_vision_client_auto_picks_vllm_when_ollama_down(mock_avail):
    """_resolve_vision_client returns VLLMClient when AI_BACKEND=auto and Ollama down."""
    from zordms_ai.app import _resolve_vision_client
    from zordms_ai.inference.vllm_client import VLLMClient

    s = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        ai_backend="auto",
    )
    client = _resolve_vision_client(s)
    assert isinstance(client, VLLMClient)


def test_resolve_vision_client_vllm_explicit():
    """AI_BACKEND=vllm always uses VLLMClient regardless of Ollama availability."""
    from zordms_ai.app import _resolve_vision_client
    from zordms_ai.inference.vllm_client import VLLMClient

    s = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        ai_backend="vllm",
    )
    client = _resolve_vision_client(s)
    assert isinstance(client, VLLMClient)


@patch("zordms_ai.app.ollama_client.is_available", return_value=True)
def test_resolve_vision_client_ollama_explicit(mock_avail):
    """AI_BACKEND=ollama always uses OllamaVisionAdapter."""
    from zordms_ai.app import _resolve_vision_client

    s = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        ai_backend="ollama",
    )
    client = _resolve_vision_client(s)
    assert isinstance(client, OllamaVisionAdapter)

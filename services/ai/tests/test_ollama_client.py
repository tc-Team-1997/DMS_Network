"""Tests for the Ollama client and adapter.

All Ollama HTTP calls are mocked — no network or running model required.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
import respx

from zordms_ai.inference import ollama_client
from zordms_ai.inference.ollama_client import OllamaError
from zordms_ai.inference.ollama_adapter import OllamaVisionAdapter, _extract_json


# ──────────────────────────────────────────────────────────────────────────────
# _extract_json — JSON extraction from free-form text
# ──────────────────────────────────────────────────────────────────────────────

def test_extract_json_clean():
    assert _extract_json('{"doc_type": "BT_CID_4G", "confidence": 0.9}') == {
        "doc_type": "BT_CID_4G",
        "confidence": 0.9,
    }


def test_extract_json_with_prose():
    text = 'Sure! Here is the result:\n{"doc_type": "BT_PASSPORT", "confidence": 0.85}'
    result = _extract_json(text)
    assert result["doc_type"] == "BT_PASSPORT"
    assert result["confidence"] == 0.85


def test_extract_json_trailing_comma_repair():
    text = '{"doc_type": "BT_CID_4G", "signals": ["mrz", "logo",]}'
    result = _extract_json(text)
    assert result["doc_type"] == "BT_CID_4G"


def test_extract_json_raises_on_no_json():
    with pytest.raises(ValueError, match="No valid JSON"):
        _extract_json("This is just plain text without any JSON")


# ──────────────────────────────────────────────────────────────────────────────
# is_available
# ──────────────────────────────────────────────────────────────────────────────

@respx.mock
def test_is_available_returns_true_when_200():
    respx.get("http://localhost:11434/api/tags").mock(
        return_value=httpx.Response(200, json={"models": []})
    )
    assert ollama_client.is_available("http://localhost:11434") is True


@respx.mock
def test_is_available_returns_false_on_connect_error():
    respx.get("http://localhost:11434/api/tags").mock(side_effect=httpx.ConnectError("refused"))
    assert ollama_client.is_available("http://localhost:11434") is False


@respx.mock
def test_is_available_returns_false_on_non_200():
    respx.get("http://localhost:11434/api/tags").mock(
        return_value=httpx.Response(503)
    )
    assert ollama_client.is_available("http://localhost:11434") is False


# ──────────────────────────────────────────────────────────────────────────────
# vision_complete — payload structure and content parsing
# ──────────────────────────────────────────────────────────────────────────────

@respx.mock
def test_vision_complete_sends_correct_payload_and_returns_content():
    """vision_complete must POST to /api/chat with images array and return message.content."""
    route = respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={"message": {"content": '{"doc_type": "BT_PASSPORT", "confidence": 0.9, "signals": []}'}},
        )
    )
    result = ollama_client.vision_complete(
        "Classify this image.",
        "QUJD",  # fake base64
        model="qwen2.5vl:7b",
        base_url="http://localhost:11434",
        timeout=10.0,
    )
    assert '{"doc_type"' in result

    # Verify payload structure
    sent = json.loads(route.calls[0].request.content)
    assert sent["model"] == "qwen2.5vl:7b"
    assert sent["stream"] is False
    msgs = sent["messages"]
    assert len(msgs) == 1
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "Classify this image."
    # images field must be a list with the raw base64 (no data-URI prefix)
    assert msgs[0]["images"] == ["QUJD"]


@respx.mock
def test_vision_complete_raises_ollama_error_on_http_error():
    respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(500, text="Internal Server Error")
    )
    with pytest.raises(OllamaError, match="Ollama HTTP 500"):
        ollama_client.vision_complete(
            "prompt", "QUJD",
            model="qwen2.5vl:7b",
            base_url="http://localhost:11434",
            timeout=5.0,
        )


@respx.mock
def test_vision_complete_raises_ollama_error_on_missing_key():
    respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(200, json={"unexpected": "structure"})
    )
    with pytest.raises(OllamaError, match="parse error"):
        ollama_client.vision_complete(
            "prompt", "QUJD",
            model="qwen2.5vl:7b",
            base_url="http://localhost:11434",
            timeout=5.0,
        )


# ──────────────────────────────────────────────────────────────────────────────
# text_complete — payload structure
# ──────────────────────────────────────────────────────────────────────────────

@respx.mock
def test_text_complete_sends_correct_payload():
    route = respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={"message": {"content": "Based on the documents, ..."}},
        )
    )
    result = ollama_client.text_complete(
        "What are the KYC requirements?",
        model="granite3.3:8b",
        base_url="http://localhost:11434",
        timeout=30.0,
        system="You are ZorDMS Copilot.",
    )
    assert result == "Based on the documents, ..."

    sent = json.loads(route.calls[0].request.content)
    assert sent["model"] == "granite3.3:8b"
    assert sent["stream"] is False
    # system prompt must appear as first message
    assert sent["messages"][0]["role"] == "system"
    assert "ZorDMS" in sent["messages"][0]["content"]
    assert sent["messages"][1]["role"] == "user"
    assert sent["messages"][1]["content"] == "What are the KYC requirements?"


@respx.mock
def test_text_complete_without_system():
    route = respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200, json={"message": {"content": "answer"}}
        )
    )
    ollama_client.text_complete(
        "Hello",
        model="granite3.3:8b",
        base_url="http://localhost:11434",
        timeout=10.0,
        system=None,
    )
    sent = json.loads(route.calls[0].request.content)
    # No system message when system=None
    assert all(m["role"] != "system" for m in sent["messages"])


# ──────────────────────────────────────────────────────────────────────────────
# OllamaVisionAdapter — chat_json wraps vision_complete
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_adapter_chat_json_with_image_calls_vision_complete():
    """OllamaVisionAdapter.chat_json must call /api/chat with images array."""
    expected_json = {"doc_type": "BT_PASSPORT", "confidence": 0.95, "signals": ["maroon cover"]}
    respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={"message": {"content": json.dumps(expected_json)}},
        )
    )
    adapter = OllamaVisionAdapter(
        base_url="http://localhost:11434",
        vlm_model="qwen2.5vl:7b",
        timeout_s=10.0,
    )
    result = await adapter.chat_json(
        model="qwen2.5vl:7b",
        system="You classify documents.",
        user_text="Classify this document.",
        image_b64="QUJD",
        json_schema={"type": "object"},
    )
    assert result == expected_json


@pytest.mark.asyncio
@respx.mock
async def test_adapter_chat_json_raises_on_ollama_error():
    respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(503, text="service unavailable")
    )
    adapter = OllamaVisionAdapter(
        base_url="http://localhost:11434",
        vlm_model="qwen2.5vl:7b",
        timeout_s=5.0,
    )
    with pytest.raises(OllamaError):
        await adapter.chat_json(
            model="qwen2.5vl:7b",
            system="sys",
            user_text="classify",
            image_b64="QUJD",
            json_schema={"type": "object"},
        )

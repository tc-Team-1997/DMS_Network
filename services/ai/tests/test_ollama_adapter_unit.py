"""Micro-level unit tests for inference.ollama_adapter prompt composition.

The existing test_ollama_client.py verifies the happy-path chat_json over HTTP.
Here we assert the *prompt-building* logic (field guide from json_schema props,
enum extraction via $ref, and the text-only path) by intercepting the
ollama_client functions directly — no HTTP.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from zordms_ai.inference.ollama_adapter import OllamaVisionAdapter, _extract_json


def _adapter() -> OllamaVisionAdapter:
    return OllamaVisionAdapter(base_url="http://o.test", vlm_model="qwen2.5vl", timeout_s=5.0)


# ── _extract_json fast-path + repair + raise (extra cases) ──────────────────

def test_extract_json_dict_of_objects_repaired():
    assert _extract_json('{"a": 1, "b": [1, 2,],}') == {"a": 1, "b": [1, 2]}


def test_extract_json_raises_on_garbage():
    with pytest.raises(ValueError, match="No valid JSON"):
        _extract_json("nothing structured here")


# ── chat_json with image: builds a field guide from schema props ────────────

@pytest.mark.asyncio
async def test_chat_json_builds_field_guide_and_calls_vision():
    schema = {
        "type": "object",
        "properties": {
            "doc_type": {"type": "string", "description": "the kind of doc"},
            "status": {"allOf": [{"$ref": "#/$defs/Status"}]},
        },
        "$defs": {"Status": {"enum": ["ACTIVE", "EXPIRED"]}},
    }
    captured = {}

    def fake_vision(prompt, image_b64, *, model, base_url, timeout):
        captured["prompt"] = prompt
        captured["image_b64"] = image_b64
        captured["model"] = model
        return '{"doc_type": "passport", "status": "ACTIVE"}'

    with patch("zordms_ai.inference.ollama_client.vision_complete", side_effect=fake_vision):
        out = await _adapter().chat_json(
            model="", system="SYS", user_text="USER",
            image_b64="IMG64", json_schema=schema,
        )

    assert out == {"doc_type": "passport", "status": "ACTIVE"}
    p = captured["prompt"]
    # system + user_text embedded
    assert "SYS" in p and "USER" in p
    # field guide lines for each prop
    assert "- doc_type" in p
    assert "the kind of doc" in p          # description surfaced
    assert "one of: ACTIVE, EXPIRED" in p  # enum resolved through $ref
    # explicit key contract included
    assert "doc_type, status" in p
    # empty model arg -> falls back to adapter's configured model
    assert captured["model"] == "qwen2.5vl"
    assert captured["image_b64"] == "IMG64"


@pytest.mark.asyncio
async def test_chat_json_no_props_uses_generic_prompt():
    captured = {}

    def fake_vision(prompt, image_b64, *, model, base_url, timeout):
        captured["prompt"] = prompt
        return '{"x": 1}'

    with patch("zordms_ai.inference.ollama_client.vision_complete", side_effect=fake_vision):
        out = await _adapter().chat_json(
            model="m", system="S", user_text="U",
            image_b64="IMG", json_schema={"type": "object"},
        )
    assert out == {"x": 1}
    assert "single JSON object" in captured["prompt"]


@pytest.mark.asyncio
async def test_chat_json_text_path_when_no_image():
    captured = {}

    def fake_text(prompt, *, model, base_url, timeout, system):
        captured["prompt"] = prompt
        captured["system"] = system
        captured["model"] = model
        return '{"answer": "ok"}'

    with patch("zordms_ai.inference.ollama_client.text_complete", side_effect=fake_text):
        out = await _adapter().chat_json(
            model="textm", system="S", user_text="U",
            image_b64=None, json_schema={"type": "object"},
        )
    assert out == {"answer": "ok"}
    # text path passes system=None (system already embedded in combined prompt)
    assert captured["system"] is None
    assert captured["model"] == "textm"


@pytest.mark.asyncio
async def test_chat_json_propagates_extract_error_on_bad_reply():
    with patch("zordms_ai.inference.ollama_client.vision_complete",
               return_value="totally not json"):
        with pytest.raises(ValueError, match="No valid JSON"):
            await _adapter().chat_json(
                model="m", system="S", user_text="U",
                image_b64="IMG", json_schema={"type": "object"},
            )

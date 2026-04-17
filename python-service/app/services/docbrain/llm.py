"""Thin Ollama wrapper. One place to swap to vLLM / TGI in production.

Env:
    OLLAMA_HOST         (default http://localhost:11434)
    DOCBRAIN_MODEL      (default llama3.2:3b — dev; prod uses llama3.1:70b)
    DOCBRAIN_EMBED      (default nomic-embed-text)
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

import ollama

log = logging.getLogger(__name__)

OLLAMA_HOST   = os.environ.get("OLLAMA_HOST",      "http://localhost:11434")
CHAT_MODEL    = os.environ.get("DOCBRAIN_MODEL",   "llama3.2:3b")
EMBED_MODEL   = os.environ.get("DOCBRAIN_EMBED",   "nomic-embed-text")

_client: Optional[ollama.Client] = None


def client() -> ollama.Client:
    """Lazy singleton. Tests can monkeypatch this module attribute."""
    global _client
    if _client is None:
        _client = ollama.Client(host=OLLAMA_HOST)
    return _client


def chat_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.1,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    JSON-structured LLM call. Llama gets `format='json'` which forces a JSON
    object, with a deterministic low-temp default. Falls back to `{}` on any
    parse error (logged), so callers never need a try/except around this.
    """
    try:
        resp = client().chat(
            model=model or CHAT_MODEL,
            format="json",
            options={"temperature": temperature},
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("Ollama chat call failed: %s", exc)
        return {}

    raw = resp.get("message", {}).get("content", "").strip()
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        log.warning("Ollama returned non-JSON despite format=json: %.200s", raw)
        return {}


def chat_text(
    system: str,
    user: str,
    *,
    temperature: float = 0.2,
    model: Optional[str] = None,
) -> str:
    """Unstructured chat; used by RAG answer generation."""
    try:
        resp = client().chat(
            model=model or CHAT_MODEL,
            options={"temperature": temperature},
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("Ollama chat_text failed: %s", exc)
        return ""
    return resp.get("message", {}).get("content", "").strip()


def embed(text: str, *, model: Optional[str] = None) -> List[float]:
    """Single-text embedding. Empty input returns an empty vector."""
    if not text or not text.strip():
        return []
    try:
        resp = client().embeddings(model=model or EMBED_MODEL, prompt=text)
    except Exception as exc:  # noqa: BLE001
        log.exception("Ollama embeddings failed: %s", exc)
        return []
    return list(resp.get("embedding", []))


def healthcheck() -> Dict[str, Any]:
    """
    Returns {status, host, chat_model_ready, embed_model_ready}. Used by
    FastAPI /health/docbrain and by tests that gate on model availability.
    """
    out = {
        "status":             "down",
        "host":               OLLAMA_HOST,
        "chat_model":         CHAT_MODEL,
        "embed_model":        EMBED_MODEL,
        "chat_model_ready":   False,
        "embed_model_ready":  False,
    }
    try:
        tags = client().list().get("models", [])
        names = {m.get("name", m.get("model", "")) for m in tags}
        out["chat_model_ready"]  = any(CHAT_MODEL in n for n in names)
        out["embed_model_ready"] = any(EMBED_MODEL in n for n in names)
        out["status"] = "up"
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)
    return out

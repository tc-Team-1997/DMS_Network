"""Ollama HTTP client for local LLM inference.

Exposes three thin functions that the rest of the codebase calls:

    vision_complete(prompt, image_b64, *, model, base_url, timeout) -> str
    text_complete(prompt, *, model, base_url, timeout, system) -> str
    is_available(base_url) -> bool
"""
from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)


class OllamaError(RuntimeError):
    """Raised when the Ollama API returns an error or is unreachable."""


def is_available(base_url: str, *, timeout: float = 3.0) -> bool:
    """Return True if Ollama is reachable at *base_url* (GET /api/tags)."""
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(f"{base_url.rstrip('/')}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


def vision_complete(
    prompt: str,
    image_b64: str,
    *,
    model: str,
    base_url: str,
    timeout: float,
) -> str:
    """POST /api/chat with an image (raw base64 in the images array).

    Ollama accepts raw base64 (no data-URI prefix) in the ``images`` field.
    Returns the assistant message content string.
    Raises :class:`OllamaError` on any HTTP or parse failure.
    """
    url = f"{base_url.rstrip('/')}/api/chat"
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [image_b64],
            }
        ],
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
        return data["message"]["content"]
    except httpx.HTTPStatusError as exc:
        raise OllamaError(f"Ollama HTTP {exc.response.status_code}: {exc.response.text}") from exc
    except (KeyError, ValueError) as exc:
        raise OllamaError(f"Ollama response parse error: {exc}") from exc
    except httpx.RequestError as exc:
        raise OllamaError(f"Ollama request error: {exc}") from exc


def text_complete(
    prompt: str,
    *,
    model: str,
    base_url: str,
    timeout: float,
    system: str | None = None,
) -> str:
    """POST /api/chat text-only (no image).

    Returns the assistant message content string.
    Raises :class:`OllamaError` on any HTTP or parse failure.
    """
    url = f"{base_url.rstrip('/')}/api/chat"
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "stream": False,
        "messages": messages,
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
        return data["message"]["content"]
    except httpx.HTTPStatusError as exc:
        raise OllamaError(f"Ollama HTTP {exc.response.status_code}: {exc.response.text}") from exc
    except (KeyError, ValueError) as exc:
        raise OllamaError(f"Ollama response parse error: {exc}") from exc
    except httpx.RequestError as exc:
        raise OllamaError(f"Ollama request error: {exc}") from exc

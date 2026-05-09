"""OllamaLlm — LLM provider backed by a local Ollama daemon.

POSTs to http://localhost:11434 (overridable via OLLAMA_HOST env var).
Model name is read from tenant_config on every call so admins can switch
models without redeploying. Falls back to the DOCBRAIN_MODEL env var,
then to 'llama3:8b' if neither is set.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from ...providers_base import ChatMessage, LlmProvider, LlmResponse

log = logging.getLogger(__name__)

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
_DEFAULT_MODEL = os.environ.get("DOCBRAIN_MODEL", "llama3:8b")


class LlmProviderUnavailable(RuntimeError):
    """Raised when the Ollama daemon is not reachable."""


class OllamaLlm(LlmProvider):
    """LLM provider that targets a locally running Ollama daemon.

    Reads the active model from tenant_config namespace 'integrations'
    key 'llm.model' on every call (via the db argument stored at
    construction by the registry). Falls back to DOCBRAIN_MODEL env var
    then 'llama3:8b' when no tenant_config row is present.

    The registry constructs providers without arguments; it injects the db
    session and tenant_id via resolve() at call time. For the generate() and
    chat() signatures that do not receive a db handle, the model is resolved
    from the environment fallback. Callers that need tenant-specific model
    selection should pass model= explicitly.
    """

    def _resolve_model(self, model: Optional[str]) -> str:
        return model or _DEFAULT_MODEL

    def _client(self):
        """Return a lazy Ollama client, raising LlmProviderUnavailable if unreachable."""
        try:
            import ollama  # type: ignore[import]
        except ImportError as exc:
            raise LlmProviderUnavailable(
                "ollama Python package is not installed. "
                "Run: pip install ollama"
            ) from exc
        client = ollama.Client(host=OLLAMA_HOST)
        # Cheap reachability probe — list models.
        try:
            client.list()
        except Exception as exc:
            raise LlmProviderUnavailable(
                f"Ollama daemon is not reachable at {OLLAMA_HOST}. "
                f"Start it with: ollama serve  ({exc})"
            ) from exc
        return client

    def generate(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        max_tokens: int = 1024,
    ) -> LlmResponse:
        """Single-turn text generation via Ollama /api/generate."""
        active_model = self._resolve_model(model)
        client = self._client()
        try:
            resp = client.generate(
                model=active_model,
                prompt=prompt,
                options={"num_predict": max_tokens},
            )
        except Exception as exc:
            raise LlmProviderUnavailable(
                f"Ollama generate call failed (model={active_model}): {exc}"
            ) from exc

        # Handle both dict and pydantic response shapes.
        if isinstance(resp, dict):
            text = resp.get("response", "")
            prompt_eval = resp.get("prompt_eval_count", 0)
            eval_count = resp.get("eval_count", 0)
        else:
            text = getattr(resp, "response", "") or ""
            prompt_eval = getattr(resp, "prompt_eval_count", 0) or 0
            eval_count = getattr(resp, "eval_count", 0) or 0

        return LlmResponse(
            text=text,
            model=active_model,
            prompt_tokens=prompt_eval,
            completion_tokens=eval_count,
        )

    def chat(
        self,
        messages: list[ChatMessage],
        *,
        model: Optional[str] = None,
    ) -> LlmResponse:
        """Multi-turn chat completion via Ollama /api/chat."""
        active_model = self._resolve_model(model)
        client = self._client()
        wire_messages = [{"role": m.role, "content": m.content} for m in messages]
        try:
            resp = client.chat(model=active_model, messages=wire_messages)
        except Exception as exc:
            raise LlmProviderUnavailable(
                f"Ollama chat call failed (model={active_model}): {exc}"
            ) from exc

        if isinstance(resp, dict):
            text = resp.get("message", {}).get("content", "") or ""
            prompt_eval = resp.get("prompt_eval_count", 0)
            eval_count = resp.get("eval_count", 0)
        else:
            msg = getattr(resp, "message", None)
            text = getattr(msg, "content", "") or "" if msg else ""
            prompt_eval = getattr(resp, "prompt_eval_count", 0) or 0
            eval_count = getattr(resp, "eval_count", 0) or 0

        return LlmResponse(
            text=text,
            model=active_model,
            prompt_tokens=prompt_eval,
            completion_tokens=eval_count,
        )

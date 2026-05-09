"""OllamaTranslate — translation provider backed by a local Ollama LLM.

Special handling for Dzongkha (target_lang='dz'): uses a dedicated prompt
template that instructs the model to output Tibetan script without explanation.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from ...providers_base import TranslateProvider

log = logging.getLogger(__name__)

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
_DEFAULT_MODEL = os.environ.get("DOCBRAIN_MODEL", "llama3:8b")

# Dzongkha-specific prompt — instructs model to output Tibetan script only.
_DZ_PROMPT_TEMPLATE = (
    "Translate the following text from {source_lang} to Dzongkha "
    "(Tibetan script). Return only the translation, no explanation.\n\n"
    "Text: {text}"
)

_GENERIC_PROMPT_TEMPLATE = (
    "Translate the following text from {source_lang} to {target_lang}. "
    "Return only the translated text, no explanation or commentary.\n\n"
    "Text: {text}"
)


class OllamaTranslate(TranslateProvider):
    """Translation provider using a locally running Ollama LLM.

    Special case: target_lang='dz' (Dzongkha / Tibetan script) uses a
    dedicated prompt to maximise model compliance with the script requirement.

    The model is read from DOCBRAIN_MODEL env var, defaulting to 'llama3:8b'.
    For production quality on Dzongkha, use a multilingual model such as
    'aya:8b' or 'qwen2.5:7b' which have better Tibetan script coverage.
    """

    def _client(self):
        try:
            import ollama  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError(
                "ollama Python package is not installed. Run: pip install ollama"
            ) from exc
        return ollama.Client(host=OLLAMA_HOST)

    def translate(
        self,
        text: str,
        *,
        source_lang: str,
        target_lang: str,
    ) -> str:
        """Translate *text* via the local Ollama model.

        Uses a Dzongkha-specific prompt when target_lang is 'dz' to maximise
        Tibetan script output quality.
        """
        if target_lang == "dz":
            prompt = _DZ_PROMPT_TEMPLATE.format(
                source_lang=source_lang,
                text=text,
            )
        else:
            prompt = _GENERIC_PROMPT_TEMPLATE.format(
                source_lang=source_lang,
                target_lang=target_lang,
                text=text,
            )

        client = self._client()
        try:
            resp = client.generate(model=_DEFAULT_MODEL, prompt=prompt)
        except Exception as exc:
            log.error(
                "OllamaTranslate: Ollama generate failed (%s→%s): %s",
                source_lang, target_lang, exc,
            )
            raise RuntimeError(
                f"Translation failed ({source_lang}→{target_lang}): {exc}"
            ) from exc

        if isinstance(resp, dict):
            return (resp.get("response") or "").strip()
        return (getattr(resp, "response", "") or "").strip()

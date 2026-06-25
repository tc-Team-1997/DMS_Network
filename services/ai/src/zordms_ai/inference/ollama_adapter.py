"""Adapter that wraps ollama_client functions behind the VLLMClient interface.

Classifier and Extractor call ``client.chat_json(...)`` and don't care which
backend produced the JSON.  This adapter fulfils that contract using the
Ollama /api/chat endpoint and adds:

  - JSON extraction from free-form model output (regex + json.loads fallback)
  - Graceful error handling: raises so callers can catch and degrade
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from zordms_ai.inference import ollama_client
from zordms_ai.inference.ollama_client import OllamaError

logger = logging.getLogger(__name__)

# Regex to extract the first {...} JSON block from free-form output
_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json(text: str) -> dict[str, Any]:
    """Extract the first JSON object from *text*.

    Ollama models (especially vision ones) often emit prose around the JSON,
    so we strip it before parsing.
    """
    # Fast path: the whole string might already be valid JSON
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find a JSON block in the response
    m = _JSON_BLOCK_RE.search(text)
    if m:
        candidate = m.group(0)
        # Attempt basic auto-repair: fix trailing commas before ] or }
        candidate = re.sub(r",\s*([}\]])", r"\1", candidate)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    raise ValueError(f"No valid JSON object found in Ollama response: {text[:300]!r}")


class OllamaVisionAdapter:
    """Drop-in replacement for VLLMClient for the Classifier and Extractor.

    Both classes call ``await client.chat_json(model=..., system=...,
    user_text=..., image_b64=..., json_schema=...)`` and expect a ``dict``.

    This adapter:
      1. Embeds the system prompt into the user prompt (Ollama chat has no
         dedicated system-role support for vision models).
      2. Calls ``ollama_client.vision_complete`` (sync, run in thread).
      3. Parses the free-text response back to a dict.
    """

    def __init__(
        self,
        base_url: str,
        vlm_model: str,
        timeout_s: float,
    ) -> None:
        self._base_url = base_url
        self._model = vlm_model
        self._timeout = timeout_s

    async def chat_json(
        self,
        *,
        model: str,
        system: str,
        user_text: str,
        image_b64: str | None,
        json_schema: dict[str, Any],
    ) -> dict[str, Any]:
        """Call Ollama and return a parsed dict.  Raises OllamaError on failure."""
        import asyncio

        # Build a combined prompt. We deliberately DO NOT dump the raw JSON
        # schema ($defs/enums/types) — vision models tend to echo the schema
        # back. Instead we present a flat field guide and ask for real values.
        props: dict[str, Any] = json_schema.get("properties", {}) or {}
        defs: dict[str, Any] = json_schema.get("$defs", {}) or {}

        def _enum_for(spec: dict[str, Any]) -> list[Any] | None:
            if "enum" in spec:
                return spec["enum"]
            ref = spec.get("$ref")
            if not ref and isinstance(spec.get("allOf"), list) and spec["allOf"]:
                ref = spec["allOf"][0].get("$ref")
            if ref:
                return defs.get(ref.split("/")[-1], {}).get("enum")
            return None

        if props:
            guide_lines = []
            for key, spec in props.items():
                spec = spec if isinstance(spec, dict) else {}
                enum_vals = _enum_for(spec)
                hint = f" (one of: {', '.join(map(str, enum_vals))})" if enum_vals else ""
                desc = spec.get("description")
                guide_lines.append(f"- {key}{hint}" + (f" — {desc}" if desc else ""))
            keys = ", ".join(props.keys())
            field_guide = "\n".join(guide_lines)
            combined_prompt = (
                f"{system}\n\n{user_text}\n\n"
                f"Read the document in the image and extract these fields:\n{field_guide}\n\n"
                f"Respond with ONLY one JSON object whose keys are exactly: {keys}.\n"
                f"Each value must be the ACTUAL value read from the document — not the field "
                f"name, not a type. Use null when a field is not present. "
                f"No markdown fences, no schema, no explanation — just the JSON object."
            )
        else:
            combined_prompt = (
                f"{system}\n\n{user_text}\n\n"
                f"Respond with ONLY a single JSON object of the document's field values. "
                f"No markdown, no schema, no explanation."
            )

        effective_model = model if model else self._model

        if image_b64:
            raw = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: ollama_client.vision_complete(
                    combined_prompt,
                    image_b64,
                    model=effective_model,
                    base_url=self._base_url,
                    timeout=self._timeout,
                ),
            )
        else:
            raw = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: ollama_client.text_complete(
                    combined_prompt,
                    model=effective_model,
                    base_url=self._base_url,
                    timeout=self._timeout,
                    system=None,
                ),
            )

        return _extract_json(raw)

"""LLM-backed translation (§5.8) — Dzongkha ↔ English (and general).

Uses the on-prem Ollama text model (the §5 local-models design). The completion
function is injectable so tests run without a model; on any failure or empty
output the original text is returned with degraded=True — never an error
(mirrors the OCR/copilot fallback pattern). Real translation quality depends on
the text model being deployed.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Optional

from zordms_ai.inference import ollama_client

logger = logging.getLogger(__name__)

# Supported language codes → human names for the prompt.
LANG_NAMES: dict[str, str] = {
    "en": "English", "eng": "English",
    "dzo": "Dzongkha", "dz": "Dzongkha",
}
SUPPORTED = set(LANG_NAMES.keys())

# Injectable completion: (text, *, system, settings) -> str
CompleteFn = Callable[..., Awaitable[str]]


async def _ollama_complete(text: str, *, system: str, settings: Any) -> str:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: ollama_client.text_complete(
            text,
            model=getattr(settings, "ollama_text_model", "granite3.3:8b"),
            base_url=getattr(settings, "ollama_base_url", "http://localhost:11434"),
            timeout=getattr(settings, "ollama_timeout_s", 180.0),
            system=system,
        ),
    )


async def translate(
    text: str,
    target: str,
    source: Optional[str] = None,
    *,
    settings: Any,
    complete: Optional[CompleteFn] = None,
) -> dict:
    """Translate *text* into *target* (optionally from *source*)."""
    base = {"target": target, "source": source}
    if not (text or "").strip():
        return {**base, "translated": "", "engine": "noop", "degraded": False}

    target_name = LANG_NAMES.get((target or "").lower(), target)
    src_clause = f" from {LANG_NAMES.get(source.lower(), source)}" if source else ""
    system = (
        f"You are a professional translator. Translate the user's text{src_clause} "
        f"into {target_name}. Output ONLY the translation — no preamble, notes, or quotes."
    )

    fn = complete or _ollama_complete
    try:
        out = (await fn(text, system=system, settings=settings) or "").strip()
    except Exception as exc:  # noqa: BLE001 — degrade on any model/transport error
        logger.warning("translation degraded (%s); returning original text", exc)
        out = ""

    if not out:
        return {**base, "translated": text, "engine": "degraded", "degraded": True}
    return {**base, "translated": out, "engine": f"ollama:{getattr(settings, 'ollama_text_model', 'granite3.3:8b')}", "degraded": False}

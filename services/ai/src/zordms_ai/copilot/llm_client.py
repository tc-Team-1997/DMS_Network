"""LLM integration layer for the copilot.

Priority:
  1. Anthropic SDK  (if ANTHROPIC_API_KEY is set)
  2. OpenAI SDK     (if OPENAI_API_KEY is set)
  3. Ollama local   (if Ollama is available and no cloud key configured)
  4. Grounded-extractive fallback (always available — composes answer from snippets)

All four code paths return the same shape: (answer: str, model_label: str).
Citations are always sourced from the retrieved search hits — not hallucinated.
"""
from __future__ import annotations

import asyncio
import logging
import os
import textwrap
from typing import Any

from zordms_ai.copilot.search_client import SearchHit
from zordms_ai.inference import ollama_client

logger = logging.getLogger(__name__)

# Maximum snippet length sent to the LLM to stay within context limits.
_SNIPPET_LIMIT = 600
# Maximum total context chars sent to the LLM.
_CONTEXT_LIMIT = 8_000


def _build_context_block(hits: list[SearchHit]) -> str:
    """Build a numbered context block from search hits."""
    if not hits:
        return "(No documents retrieved)"
    parts = []
    for i, h in enumerate(hits, 1):
        snippet = h.snippet[:_SNIPPET_LIMIT].strip()
        parts.append(f"[{i}] {h.title} (doc_id={h.doc_id})\n{snippet}")
    block = "\n\n".join(parts)
    return block[:_CONTEXT_LIMIT]


def _build_system_prompt(context_block: str) -> str:
    return textwrap.dedent(f"""\
        You are ZorDMS Copilot, an enterprise document-management assistant for ZorDMS (Zor Document Management System).
        You ONLY answer based on the retrieved document context below. Do NOT invent facts.
        If the context does not contain enough information to answer, say so honestly.
        Always cite the document IDs that support your answer.

        === RETRIEVED CONTEXT ===
        {context_block}
        === END CONTEXT ===

        Respond concisely and in plain language. Reference documents by their title and doc_id.
    """)


def _build_messages(
    system: str,
    history: list[dict[str, str]],
    question: str,
) -> list[dict[str, str]]:
    msgs: list[dict[str, str]] = []
    for turn in history[-6:]:  # keep last 3 exchanges
        msgs.append({"role": turn["role"], "content": turn["content"]})
    msgs.append({"role": "user", "content": question})
    return msgs


# ─────────────────────────── Grounded-extractive fallback ────────────────────

def _extractive_answer(question: str, hits: list[SearchHit], degraded: bool) -> tuple[str, str]:
    """Compose a grounded answer directly from retrieved snippets without an LLM."""
    if not hits:
        preamble = (
            "(Search service unreachable — no documents retrieved) " if degraded else ""
        )
        return (
            f"{preamble}I could not find relevant documents in the corpus to answer your question. "
            "Please refine your query or ensure documents have been indexed.",
            "grounded-extractive-fallback",
        )

    # Compose answer from the first 3 hits
    lines = ["Based on the following retrieved documents:\n"]
    for h in hits[:3]:
        snippet = h.snippet[:300].strip()
        lines.append(f"- **{h.title}** (doc_id: `{h.doc_id}`): {snippet}")
    if len(hits) > 3:
        lines.append(f"\n_(+ {len(hits) - 3} additional document(s) also matched.)_")
    lines.append(
        "\n_This answer was composed directly from document snippets "
        "(no LLM key configured — grounded-extractive mode)._"
    )
    answer = "\n".join(lines)
    return answer, "grounded-extractive-fallback"


# ─────────────────────────── Anthropic ───────────────────────────────────────

async def _anthropic_answer(
    question: str,
    history: list[dict[str, str]],
    hits: list[SearchHit],
    settings: Any,
) -> tuple[str, str]:
    try:
        import anthropic  # type: ignore[import]
    except ImportError:
        logger.warning("anthropic package not installed; falling back to extractive")
        return _extractive_answer(question, hits, False)

    context_block = _build_context_block(hits)
    system = _build_system_prompt(context_block)
    messages = _build_messages(system, history, question)

    model = getattr(settings, "anthropic_model", "claude-haiku-4-5")
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    try:
        resp = await client.messages.create(
            model=model,
            max_tokens=1024,
            system=system,
            messages=messages,
        )
        answer = resp.content[0].text if resp.content else ""
        return answer, f"anthropic/{model}"
    except Exception as exc:
        logger.warning("Anthropic API error: %s", exc)
        return _extractive_answer(question, hits, False)


# ─────────────────────────── OpenAI ──────────────────────────────────────────

async def _openai_answer(
    question: str,
    history: list[dict[str, str]],
    hits: list[SearchHit],
    settings: Any,
) -> tuple[str, str]:
    try:
        import openai  # type: ignore[import]
    except ImportError:
        logger.warning("openai package not installed; falling back to extractive")
        return _extractive_answer(question, hits, False)

    context_block = _build_context_block(hits)
    system = _build_system_prompt(context_block)
    messages = [{"role": "system", "content": system}]
    messages.extend(_build_messages(system, history, question))

    model = getattr(settings, "openai_model", "gpt-4o-mini")
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=messages,  # type: ignore[arg-type]
            max_tokens=1024,
        )
        answer = resp.choices[0].message.content or ""
        return answer, f"openai/{model}"
    except Exception as exc:
        logger.warning("OpenAI API error: %s", exc)
        return _extractive_answer(question, hits, False)


# ─────────────────────────── Ollama ──────────────────────────────────────────

async def _ollama_answer(
    question: str,
    history: list[dict[str, str]],
    hits: list[SearchHit],
    settings: Any,
) -> tuple[str, str]:
    """Generate an answer using the local Ollama text model."""
    context_block = _build_context_block(hits)
    system = _build_system_prompt(context_block)
    # Build a single user prompt that includes conversation history
    history_text = ""
    for turn in history[-6:]:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        history_text += f"{role.capitalize()}: {content}\n"
    prompt = f"{history_text}User: {question}" if history_text else question

    base_url = getattr(settings, "ollama_base_url", "http://localhost:11434")
    model = getattr(settings, "ollama_text_model", "granite3.3:8b")
    timeout = getattr(settings, "ollama_timeout_s", 180.0)

    try:
        answer = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: ollama_client.text_complete(
                prompt,
                model=model,
                base_url=base_url,
                timeout=timeout,
                system=system,
            ),
        )
        return answer, f"ollama:{model}"
    except Exception as exc:
        logger.warning("Ollama text_complete error: %s", exc)
        return _extractive_answer(question, hits, False)


# ─────────────────────────── Public interface ─────────────────────────────────

async def generate_answer(
    question: str,
    history: list[dict[str, str]],
    hits: list[SearchHit],
    degraded: bool,
    settings: Any,
) -> tuple[str, str]:
    """Generate a grounded answer.

    Returns ``(answer_text, model_label)`` where *model_label* identifies the
    backend used (e.g. ``"anthropic/claude-haiku-4-5"``,
    ``"ollama:granite3.3:8b"``, or ``"grounded-extractive-fallback"``).

    Priority:
      1. Anthropic SDK  (if ANTHROPIC_API_KEY is set)
      2. OpenAI SDK     (if OPENAI_API_KEY is set)
      3. Ollama local   (if Ollama is available)
      4. Grounded-extractive fallback
    """
    anthropic_key = getattr(settings, "anthropic_api_key", None) or os.environ.get("ANTHROPIC_API_KEY")
    openai_key = getattr(settings, "openai_api_key", None) or os.environ.get("OPENAI_API_KEY")

    if anthropic_key:
        # Temporarily inject key onto settings object if coming from env
        if not getattr(settings, "anthropic_api_key", None):
            settings = type("_S", (object,), dict(vars(settings), anthropic_api_key=anthropic_key))()
        return await _anthropic_answer(question, history, hits, settings)

    if openai_key:
        if not getattr(settings, "openai_api_key", None):
            settings = type("_S", (object,), dict(vars(settings), openai_api_key=openai_key))()
        return await _openai_answer(question, history, hits, settings)

    # Check if Ollama is available (uses short timeout to avoid blocking)
    ollama_url = getattr(settings, "ollama_base_url", "http://localhost:11434")
    if ollama_client.is_available(ollama_url):
        return await _ollama_answer(question, history, hits, settings)

    return _extractive_answer(question, hits, degraded)

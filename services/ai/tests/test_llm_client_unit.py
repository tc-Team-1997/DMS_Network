"""Micro-level unit tests for copilot.llm_client.

Covers:
  - the grounded-extractive fallback composition (empty / few / many hits,
    degraded preamble),
  - context-block building (snippet truncation, numbering),
  - the provider-chain selection in generate_answer (Anthropic > OpenAI >
    Ollama > extractive) with all backends mocked — no network, no SDK calls.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from zordms_ai.copilot import llm_client
from zordms_ai.copilot.llm_client import (
    _build_context_block,
    _extractive_answer,
    generate_answer,
)
from zordms_ai.copilot.search_client import SearchHit


def _hit(doc_id="D1", title="Title", snippet="snippet", score=1.0) -> SearchHit:
    return SearchHit(doc_id=doc_id, title=title, snippet=snippet, score=score)


# ── _build_context_block ────────────────────────────────────────────────────

def test_context_block_empty_hits():
    assert _build_context_block([]) == "(No documents retrieved)"


def test_context_block_numbers_and_includes_doc_id():
    block = _build_context_block([_hit("A", "Alpha", "first"), _hit("B", "Beta", "second")])
    assert "[1] Alpha (doc_id=A)" in block
    assert "[2] Beta (doc_id=B)" in block
    assert "first" in block and "second" in block


def test_context_block_truncates_long_snippet():
    long_snippet = "x" * 5_000
    block = _build_context_block([_hit(snippet=long_snippet)])
    # snippet capped at _SNIPPET_LIMIT (600).
    assert block.count("x") <= llm_client._SNIPPET_LIMIT


# ── _extractive_answer — composition variants ───────────────────────────────

def test_extractive_no_hits_not_degraded():
    answer, label = _extractive_answer("q", [], degraded=False)
    assert label == "grounded-extractive-fallback"
    assert "could not find relevant documents" in answer
    assert "Search service unreachable" not in answer


def test_extractive_no_hits_degraded_has_preamble():
    answer, label = _extractive_answer("q", [], degraded=True)
    assert "Search service unreachable" in answer
    assert label == "grounded-extractive-fallback"


def test_extractive_composes_from_first_three_hits():
    hits = [_hit(f"D{i}", f"Title{i}", f"snip{i}") for i in range(5)]
    answer, label = _extractive_answer("q", hits, degraded=False)
    # Only first three rendered as bullets...
    assert "Title0" in answer and "Title2" in answer
    assert "Title3" not in answer
    # ...and the remainder is summarised.
    assert "+ 2 additional document(s)" in answer
    assert "doc_id: `D0`" in answer
    assert label == "grounded-extractive-fallback"


def test_extractive_three_hits_no_additional_note():
    hits = [_hit(f"D{i}") for i in range(3)]
    answer, _ = _extractive_answer("q", hits, degraded=False)
    assert "additional document" not in answer


def test_extractive_truncates_snippet_to_300():
    answer, _ = _extractive_answer("q", [_hit(snippet="z" * 1000)], degraded=False)
    # Each hit snippet is capped at 300 chars before rendering.
    assert "z" * 300 in answer
    assert "z" * 301 not in answer


# ── generate_answer — provider-chain selection ──────────────────────────────

@pytest.mark.asyncio
async def test_chain_prefers_anthropic_when_key_present():
    settings = SimpleNamespace(anthropic_api_key="ak", openai_api_key="ok",
                               ollama_base_url="http://o.test")
    with patch.object(llm_client, "_anthropic_answer",
                      new=AsyncMock(return_value=("A", "anthropic/m"))) as anth, \
         patch.object(llm_client, "_openai_answer", new=AsyncMock()) as oai:
        ans, label = await generate_answer("q", [], [_hit()], degraded=False, settings=settings)
    assert (ans, label) == ("A", "anthropic/m")
    anth.assert_awaited_once()
    oai.assert_not_called()


@pytest.mark.asyncio
async def test_chain_uses_openai_when_only_openai_key():
    settings = SimpleNamespace(anthropic_api_key=None, openai_api_key="ok",
                               ollama_base_url="http://o.test")
    with patch.dict("os.environ", {}, clear=False), \
         patch.object(llm_client, "_anthropic_answer", new=AsyncMock()) as anth, \
         patch.object(llm_client, "_openai_answer",
                      new=AsyncMock(return_value=("O", "openai/m"))) as oai:
        # Ensure no ambient env keys leak in.
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": ""}, clear=False):
            ans, label = await generate_answer("q", [], [_hit()], degraded=False, settings=settings)
    assert label == "openai/m"
    anth.assert_not_called()
    oai.assert_awaited_once()


@pytest.mark.asyncio
async def test_chain_uses_ollama_when_no_cloud_key_and_available():
    settings = SimpleNamespace(anthropic_api_key=None, openai_api_key=None,
                               ollama_base_url="http://o.test")
    with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": ""}, clear=False), \
         patch.object(llm_client.ollama_client, "is_available", return_value=True), \
         patch.object(llm_client, "_ollama_answer",
                      new=AsyncMock(return_value=("L", "ollama:granite"))) as oll:
        ans, label = await generate_answer("q", [], [_hit()], degraded=False, settings=settings)
    assert label == "ollama:granite"
    oll.assert_awaited_once()


@pytest.mark.asyncio
async def test_chain_falls_back_to_extractive_when_nothing_available():
    settings = SimpleNamespace(anthropic_api_key=None, openai_api_key=None,
                               ollama_base_url="http://o.test")
    with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": ""}, clear=False), \
         patch.object(llm_client.ollama_client, "is_available", return_value=False):
        ans, label = await generate_answer(
            "q", [], [_hit("D1", "Loan", "body")], degraded=True, settings=settings
        )
    assert label == "grounded-extractive-fallback"
    assert "Loan" in ans

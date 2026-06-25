"""Micro-level unit tests for copilot.search_client.

Covers keyword extraction, the boolean-OR query build, response normalisation
across varied shapes, and the three degraded (unreachable/timeout/HTTP) paths.
All HTTP is mocked with respx — no network.
"""
from __future__ import annotations

import json

import httpx
import pytest
import respx

from zordms_ai.copilot import search_client
from zordms_ai.copilot.search_client import SearchHit, SearchResult, _keywords, retrieve

SEARCH_URL = "http://search.test:4004"


# ── _keywords — stopword removal, length filter, lowercasing ────────────────

def test_keywords_drops_stopwords_and_short_tokens():
    kw = _keywords("Show me the loan documents")
    # "show", "me", "the" are stopwords; remaining content words kept, lowercased.
    assert kw == ["loan", "documents"]


def test_keywords_drops_tokens_of_len_le_2():
    # "a", "ab" dropped (len <= 2); "abc" kept.
    assert _keywords("a ab abc") == ["abc"]


def test_keywords_alnum_only_splits_on_punctuation():
    # Splits on punctuation; "99" is len 2 so dropped by the >2 length filter.
    assert _keywords("invoice-2024, ref#99") == ["invoice", "2024", "ref"]


def test_keywords_all_stopwords_returns_empty():
    assert _keywords("show me the all any") == []


# ── retrieve — boolean OR query build for keyword-bearing questions ─────────

@pytest.mark.asyncio
@respx.mock
async def test_retrieve_builds_boolean_or_query():
    route = respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(200, json={"hits": []})
    )
    await retrieve("show me the loan documents", search_url=SEARCH_URL)

    body = json.loads(route.calls[0].request.content)
    assert body["mode"] == "boolean"
    assert body["text"] == "loan OR documents"
    assert body["page"] == 1
    assert body["pageSize"] == 5


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_falls_back_to_fulltext_when_no_keywords():
    route = respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(200, json={"hits": []})
    )
    # All-stopword question -> no keywords -> raw text + fulltext mode.
    await retrieve("show me the all", search_url=SEARCH_URL)
    body = json.loads(route.calls[0].request.content)
    assert body["mode"] == "fulltext"
    assert body["text"] == "show me the all"


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_passes_auth_token_and_limit():
    route = respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(200, json={"hits": []})
    )
    await retrieve("loan", search_url=SEARCH_URL, auth_token="tok123", limit=3)
    req = route.calls[0].request
    assert req.headers["Authorization"] == "Bearer tok123"
    assert json.loads(req.content)["pageSize"] == 3


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_strips_trailing_slash_from_url():
    route = respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(200, json={"hits": []})
    )
    await retrieve("loan", search_url=f"{SEARCH_URL}/")
    assert str(route.calls[0].request.url) == f"{SEARCH_URL}/search"


# ── retrieve — response normalisation across shapes ─────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_retrieve_normalises_hits_dict_shape():
    respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(200, json={"hits": [
            {"doc_id": "D1", "title": "Loan Agreement", "snippet": "principal...", "score": 0.9},
        ]})
    )
    res = await retrieve("loan", search_url=SEARCH_URL)
    assert not res.degraded
    assert res.hits == [SearchHit(doc_id="D1", title="Loan Agreement", snippet="principal...", score=0.9)]


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_normalises_bare_list_and_alt_field_names():
    # Top-level list, and alt keys: id/name/content/_score.
    respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(200, json=[
            {"id": "X9", "name": "Passport", "content": "MRZ line", "_score": 2.5},
        ])
    )
    res = await retrieve("passport", search_url=SEARCH_URL)
    h = res.hits[0]
    assert (h.doc_id, h.title, h.snippet, h.score) == ("X9", "Passport", "MRZ line", 2.5)


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_title_falls_back_to_doc_type_humanised():
    respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(200, json={"results": [
            {"doc_id": "D2", "doc_type": "loan_agreement", "text": "..."},
        ]})
    )
    res = await retrieve("loan", search_url=SEARCH_URL)
    # No title/name -> humanised doc_type ("loan agreement").
    assert res.hits[0].title == "loan agreement"


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_caps_hits_to_limit():
    respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(200, json={"hits": [
            {"doc_id": f"D{i}"} for i in range(10)
        ]})
    )
    res = await retrieve("loan", search_url=SEARCH_URL, limit=2)
    assert len(res.hits) == 2


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_skips_non_dict_items():
    respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(200, json={"hits": ["junk", {"doc_id": "D1"}, 42]})
    )
    res = await retrieve("loan", search_url=SEARCH_URL)
    assert [h.doc_id for h in res.hits] == ["D1"]


# ── retrieve — degraded paths (connect / timeout / HTTP status) ─────────────

@pytest.mark.asyncio
@respx.mock
async def test_retrieve_degraded_on_connect_error():
    respx.post(f"{SEARCH_URL}/search").mock(side_effect=httpx.ConnectError("refused"))
    res = await retrieve("loan", search_url=SEARCH_URL)
    assert isinstance(res, SearchResult)
    assert res.degraded is True
    assert res.hits == []
    assert res.error and "refused" in res.error


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_degraded_on_timeout():
    respx.post(f"{SEARCH_URL}/search").mock(side_effect=httpx.ReadTimeout("slow"))
    res = await retrieve("loan", search_url=SEARCH_URL)
    assert res.degraded is True
    assert res.hits == []


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_degraded_on_http_500():
    respx.post(f"{SEARCH_URL}/search").mock(
        return_value=httpx.Response(500, json={"error": "boom"})
    )
    res = await retrieve("loan", search_url=SEARCH_URL)
    assert res.degraded is True
    assert res.hits == []

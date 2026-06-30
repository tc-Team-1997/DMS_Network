"""Semantic re-ranking (§5.4) — embedding similarity + graceful fallback."""
import pytest

from zordms_ai.copilot.embeddings import cosine, rerank_hits
from zordms_ai.copilot.search_client import SearchHit


def test_cosine_basics():
    assert cosine([1, 0], [1, 0]) == pytest.approx(1.0)
    assert cosine([1, 0], [0, 1]) == pytest.approx(0.0)
    assert cosine([], [1]) == 0.0          # mismatched/empty → 0
    assert cosine([0, 0], [0, 0]) == 0.0   # zero vector → 0 (no div-by-zero)


def _hits():
    return [
        SearchHit(doc_id="A", title="Loan application", snippet="corporate credit loan"),
        SearchHit(doc_id="B", title="Passport", snippet="travel identity document"),
        SearchHit(doc_id="C", title="KYC form", snippet="customer due diligence"),
    ]


@pytest.mark.asyncio
async def test_rerank_reorders_by_similarity():
    # Fake embeddings: the query is closest to hit B, then C, then A.
    vectors = {
        "Q": [1.0, 0.0, 0.0],
        "Loan application\ncorporate credit loan": [0.0, 0.0, 1.0],   # A — least similar
        "Passport\ntravel identity document": [1.0, 0.0, 0.0],        # B — most similar
        "KYC form\ncustomer due diligence": [0.7, 0.0, 0.7],          # C — middle
    }

    async def fake_embed(text, **_kw):
        return vectors.get("Q" if text == "find me a passport" else text)

    reranked, used = await rerank_hits("find me a passport", _hits(), embed=fake_embed)
    assert used is True
    assert [h.doc_id for h in reranked] == ["B", "C", "A"]


@pytest.mark.asyncio
async def test_rerank_falls_back_when_query_embedding_unavailable():
    async def no_embed(_text, **_kw):
        return None

    hits = _hits()
    reranked, used = await rerank_hits("anything", hits, embed=no_embed)
    assert used is False
    assert [h.doc_id for h in reranked] == ["A", "B", "C"]  # original order preserved


@pytest.mark.asyncio
async def test_rerank_falls_back_when_one_hit_embedding_unavailable():
    calls = {"n": 0}

    async def flaky_embed(_text, **_kw):
        calls["n"] += 1
        # query + first hit embed ok; second hit returns None → fallback.
        return None if calls["n"] == 3 else [1.0, 0.0]

    hits = _hits()
    reranked, used = await rerank_hits("q", hits, embed=flaky_embed)
    assert used is False
    assert [h.doc_id for h in reranked] == ["A", "B", "C"]


@pytest.mark.asyncio
async def test_rerank_empty_hits():
    reranked, used = await rerank_hits("q", [], embed=None)
    assert reranked == []
    assert used is False

"""Semantic re-ranking for the copilot RAG path (§5.4).

Retrieval stays keyword/full-text (cheap, high-recall); this layer *re-orders* the
returned hits by embedding cosine-similarity to the question, so the most
semantically-relevant documents lead. Embeddings come from Ollama
(`/api/embeddings`); if the model is unavailable the hits keep their original
(keyword) order — graceful degradation, never an error. Real semantic quality
depends on the embed model being deployed (mirrors the OCR/§9.3 caveat).
"""
from __future__ import annotations

import logging
import math
from typing import Awaitable, Callable, Optional, Sequence, TypeVar

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_EMBED_MODEL = "nomic-embed-text"
_TIMEOUT = 10.0

# An embed function: text -> vector (or None when unavailable). Injectable for tests.
EmbedFn = Callable[..., Awaitable[Optional[list[float]]]]


async def embed_text(
    text: str,
    *,
    model: str = _DEFAULT_EMBED_MODEL,
    base_url: str = "http://localhost:11434",
    timeout: float = _TIMEOUT,
) -> Optional[list[float]]:
    """Embed *text* via Ollama. Returns None on any failure (caller falls back)."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{base_url.rstrip('/')}/api/embeddings",
                json={"model": model, "prompt": text},
            )
            resp.raise_for_status()
            emb = resp.json().get("embedding")
            return emb if isinstance(emb, list) and emb else None
    except Exception as exc:  # noqa: BLE001 — degrade on any transport/model error
        logger.warning("embedding unavailable (%s); falling back to keyword order", exc)
        return None


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


_H = TypeVar("_H")


async def rerank_hits(
    question: str,
    hits: list[_H],
    *,
    model: str = _DEFAULT_EMBED_MODEL,
    base_url: str = "http://localhost:11434",
    embed: Optional[EmbedFn] = None,
    text_of: Callable[[_H], str] | None = None,
) -> tuple[list[_H], bool]:
    """
    Re-rank *hits* by cosine similarity of their text to *question*.

    Returns ``(hits, used_semantic)``. If the query embedding or ANY hit
    embedding is unavailable, the ORIGINAL order is returned with
    ``used_semantic=False`` so ranking never silently degrades to a partial mix.
    """
    if not hits:
        return hits, False
    embed_fn = embed or embed_text
    text_fn = text_of or (lambda h: f"{getattr(h, 'title', '')}\n{getattr(h, 'snippet', '')}".strip())

    qv = await embed_fn(question, model=model, base_url=base_url)
    if qv is None:
        return hits, False

    scored: list[tuple[float, _H]] = []
    for h in hits:
        hv = await embed_fn(text_fn(h), model=model, base_url=base_url)
        if hv is None:
            return hits, False  # incomplete → keep original keyword order
        scored.append((cosine(qv, hv), h))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [h for _, h in scored], True

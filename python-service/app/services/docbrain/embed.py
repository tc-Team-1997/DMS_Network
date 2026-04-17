"""Embeddings for RAG and similarity search.

nomic-embed-text: 768-dim, small, fast on Apple silicon; multilingual-adequate
for MENA. For tier-1 production on-prem we swap to BGE-M3 (1024-dim,
multilingual state of the art).
"""
from __future__ import annotations

from typing import List

from .llm import embed

EMBED_DIM = 768  # nomic-embed-text


def embed_text(text: str) -> List[float]:
    """Return a single vector. Empty on failure (caller may skip indexing)."""
    return embed(text)


def chunk_text(text: str, *, chunk_size: int = 900, overlap: int = 150) -> List[str]:
    """
    Chunk for embedding. Sliding window over characters (not tokens — close
    enough for nomic-embed on English/Arabic; we'll switch to token-based
    when we move to BGE-M3 which has stricter context limits).
    """
    if not text:
        return []
    out: List[str] = []
    step = max(1, chunk_size - overlap)
    for start in range(0, len(text), step):
        piece = text[start:start + chunk_size].strip()
        if piece:
            out.append(piece)
    return out

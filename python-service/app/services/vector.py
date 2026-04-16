"""Vector search over OCR text.

Backends auto-selected by env:
  - **pgvector** (when DATABASE_URL is Postgres + `pgvector` extension installed):
    `vector_embeddings(document_id PK, embedding vector(384), content text)` table with
    ivfflat/HNSW index.
  - **Qdrant** (set QDRANT_URL + QDRANT_COLLECTION): remote vector DB.
  - **In-memory** (default): numpy cosine similarity over an LRU cache.

Embeddings come from sentence-transformers (`all-MiniLM-L6-v2`, 384-dim) when available,
else a deterministic hashing bag-of-words fallback so the API still works in constrained
environments. Swap in OpenAI/Cohere by replacing `embed_text()`.
"""
from __future__ import annotations
import hashlib
import math
import os
import threading
from typing import Optional

from ..config import settings


EMBED_DIM = 384
QDRANT_URL = os.environ.get("QDRANT_URL", "").strip()
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "nbe_dms_ocr")


_model = None
_model_lock = threading.Lock()


def _get_model():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            try:
                from sentence_transformers import SentenceTransformer
                _model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
            except Exception:
                _model = False  # sentinel: not available
    return _model


def embed_text(text: str) -> list[float]:
    """Dense embedding — real model if available, else hashing fallback."""
    m = _get_model()
    if m:
        v = m.encode(text or "", normalize_embeddings=True).tolist()
        return v if len(v) == EMBED_DIM else _fallback_embed(text)
    return _fallback_embed(text)


def _fallback_embed(text: str) -> list[float]:
    """Hashing vectorizer → deterministic 384-dim unit vector."""
    vec = [0.0] * EMBED_DIM
    for tok in (text or "").lower().split():
        h = int(hashlib.sha1(tok.encode()).hexdigest(), 16)
        vec[h % EMBED_DIM] += 1.0
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))  # both unit-normalized


# ─────────── pgvector backend ───────────
def _is_pg() -> bool:
    return settings.DATABASE_URL.startswith("postgresql")


def _pg_ensure_table():
    from sqlalchemy import text
    from ..db import engine
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS vector_embeddings (
                document_id INTEGER PRIMARY KEY,
                embedding vector({EMBED_DIM}),
                content TEXT
            )"""))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_vector_embeddings_hnsw "
            "ON vector_embeddings USING hnsw (embedding vector_cosine_ops)"
        ))


# ─────────── Qdrant backend ───────────
def _qdrant_client():
    if not QDRANT_URL:
        return None
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.http.models import Distance, VectorParams
        c = QdrantClient(url=QDRANT_URL)
        if QDRANT_COLLECTION not in {c.name for c in c.get_collections().collections}:
            c.recreate_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
            )
        return c
    except Exception:
        return None


# ─────────── In-memory fallback ───────────
_MEMO: dict[int, tuple[list[float], str]] = {}


def upsert(document_id: int, text: str) -> None:
    v = embed_text(text)

    if _is_pg():
        try:
            _pg_ensure_table()
            from sqlalchemy import text as sqltext
            from ..db import engine
            with engine.begin() as conn:
                conn.execute(sqltext("""
                    INSERT INTO vector_embeddings (document_id, embedding, content)
                    VALUES (:id, :emb, :c)
                    ON CONFLICT (document_id) DO UPDATE
                    SET embedding = EXCLUDED.embedding, content = EXCLUDED.content
                """), {"id": document_id, "emb": v, "c": (text or "")[:10000]})
            return
        except Exception:
            pass

    qc = _qdrant_client()
    if qc:
        try:
            from qdrant_client.http.models import PointStruct
            qc.upsert(QDRANT_COLLECTION, points=[
                PointStruct(id=document_id, vector=v, payload={"text": (text or "")[:2000]})
            ])
            return
        except Exception:
            pass

    _MEMO[document_id] = (v, text or "")


def search(query: str, top_k: int = 10) -> list[dict]:
    qv = embed_text(query)

    if _is_pg():
        try:
            from sqlalchemy import text as sqltext
            from ..db import engine
            with engine.begin() as conn:
                rows = conn.execute(sqltext("""
                    SELECT document_id, 1 - (embedding <=> :qv) AS score
                    FROM vector_embeddings
                    ORDER BY embedding <=> :qv
                    LIMIT :k
                """), {"qv": qv, "k": top_k}).fetchall()
            return [{"document_id": r[0], "score": float(r[1])} for r in rows]
        except Exception:
            pass

    qc = _qdrant_client()
    if qc:
        try:
            hits = qc.search(QDRANT_COLLECTION, query_vector=qv, limit=top_k)
            return [{"document_id": int(h.id), "score": float(h.score)} for h in hits]
        except Exception:
            pass

    scored = [(doc_id, cosine(qv, v)) for doc_id, (v, _) in _MEMO.items()]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [{"document_id": d, "score": float(s)} for d, s in scored[:top_k]]


def backend_name() -> str:
    if _is_pg():
        return "pgvector"
    if QDRANT_URL:
        return "qdrant"
    return "memory"

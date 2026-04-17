"""Vector store — SQLite-backed with in-Python cosine similarity.

This is the dev-tier store. The architecture commits to Qdrant for
silo/dedicated tenants (see TARGET_ARCHITECTURE.md §5.4) — the public
surface (`upsert_document`, `vector_search`, `delete_document`) is
identical so that swap is a single-file change.

Why not sqlite-vec: macOS Python 3.14 from Homebrew was built without
`enable_load_extension`, so we can't dynamically load extensions.
Numpy cosine over ≤ 100k chunks is well within dev latency budgets.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np

from .embed import EMBED_DIM, chunk_text, embed_text

log = logging.getLogger(__name__)

_DB_PATH = Path(os.environ.get("DOCBRAIN_DB", "./storage/docbrain.sqlite"))
_TENANT  = os.environ.get("TENANT_ID", "default")


@dataclass
class VectorHit:
    document_id: int
    chunk_index: int
    text: str
    distance: float   # cosine distance; lower = more similar


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), isolation_level=None)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS docbrain_chunks (
            rowid        INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id    TEXT NOT NULL,
            document_id  INTEGER NOT NULL,
            chunk_index  INTEGER NOT NULL,
            text         TEXT NOT NULL,
            embedding    BLOB NOT NULL,
            UNIQUE(tenant_id, document_id, chunk_index)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS docbrain_chunks_doc "
        "ON docbrain_chunks(tenant_id, document_id)"
    )
    return conn


def _encode(vec: List[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def _decode(blob: bytes) -> np.ndarray:
    n = len(blob) // 4
    return np.frombuffer(blob, dtype="<f4", count=n)


def upsert_document(
    document_id: int,
    text: str,
    *,
    tenant_id: str = _TENANT,
    replace_existing: bool = True,
) -> int:
    """Chunk + embed + store. Idempotent by default."""
    chunks = chunk_text(text)
    if not chunks:
        return 0

    conn = _connect()
    try:
        if replace_existing:
            conn.execute(
                "DELETE FROM docbrain_chunks "
                "WHERE tenant_id = ? AND document_id = ?",
                (tenant_id, document_id),
            )

        inserted = 0
        for idx, chunk in enumerate(chunks):
            vec = embed_text(chunk)
            if not vec or len(vec) != EMBED_DIM:
                log.warning("skipping chunk %s of doc %s: bad embedding",
                            idx, document_id)
                continue
            conn.execute(
                "INSERT INTO docbrain_chunks "
                "(tenant_id, document_id, chunk_index, text, embedding) "
                "VALUES (?, ?, ?, ?, ?)",
                (tenant_id, document_id, idx, chunk, _encode(vec)),
            )
            inserted += 1
        return inserted
    finally:
        conn.close()


def vector_search(
    query: str,
    *,
    tenant_id: str = _TENANT,
    document_id: Optional[int] = None,
    k: int = 6,
) -> List[VectorHit]:
    """Top-k cosine-similar chunks. Optionally scoped to a document."""
    qvec_list = embed_text(query)
    if not qvec_list or len(qvec_list) != EMBED_DIM:
        return []
    q = np.array(qvec_list, dtype="<f4")
    q_norm = q / (np.linalg.norm(q) + 1e-12)

    conn = _connect()
    try:
        where = "tenant_id = ?"
        args: list = [tenant_id]
        if document_id is not None:
            where += " AND document_id = ?"
            args.append(document_id)

        rows = conn.execute(
            f"SELECT document_id, chunk_index, text, embedding "
            f"FROM docbrain_chunks WHERE {where}",
            args,
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return []

    embs = np.vstack([_decode(r[3]) for r in rows])
    norms = np.linalg.norm(embs, axis=1) + 1e-12
    embs_norm = embs / norms[:, None]
    sims = embs_norm @ q_norm
    distances = 1.0 - sims           # cosine distance
    order = np.argsort(distances)[: k]

    return [
        VectorHit(
            document_id=int(rows[i][0]),
            chunk_index=int(rows[i][1]),
            text=str(rows[i][2]),
            distance=float(distances[i]),
        )
        for i in order
    ]


def delete_document(document_id: int, *, tenant_id: str = _TENANT) -> int:
    conn = _connect()
    try:
        cur = conn.execute(
            "DELETE FROM docbrain_chunks "
            "WHERE tenant_id = ? AND document_id = ?",
            (tenant_id, document_id),
        )
        return cur.rowcount
    finally:
        conn.close()

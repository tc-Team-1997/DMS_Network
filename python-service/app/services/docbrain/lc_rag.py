"""LangChain-backed RAG pipeline — opt-in via DOCBRAIN_USE_LANGCHAIN=1.

Keeps the same SSE contract as the custom `rag_answer_stream` in rag.py:
    {"type": "citations", "items": [...]}  (or "no_evidence")
    {"type": "token", "text": "..."}
    {"type": "done",  "has_evidence": bool, "needs_verification": bool}

Three layered retrievers, composed Runnable-style:

  1. `DocBrainRetriever` — adapts either the sqlite-vec store (default) or
     the Chroma store (DOCBRAIN_VECTOR_BACKEND=chroma) to BaseRetriever.
  2. `MultiQueryRetriever` — asks the local LLM to rephrase the user's
     question 3 ways; retrieves against all, de-dupes, merges. Materially
     improves recall on poorly-OCR'd documents.
  3. `HybridReranker` — combines cosine distance with BM25 score across
     the merged candidate pool. Keeps the top-k.

Each layer is feature-flagged so the cheap/dumb path is always available:
  DOCBRAIN_USE_LANGCHAIN=1           → enable the LangChain path
  DOCBRAIN_USE_MULTIQUERY=1          → layer 2
  DOCBRAIN_USE_HYBRID=1              → layer 3
  DOCBRAIN_VECTOR_BACKEND=chroma     → swap layer 1 backend
"""
from __future__ import annotations

import logging
import os
from typing import Dict, Iterator, List, Optional

from langchain_classic.retrievers.multi_query import MultiQueryRetriever
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from langchain_ollama import OllamaLLM

from rank_bm25 import BM25Okapi

from .llm import CHAT_MODEL, OLLAMA_HOST
from .rag import MAX_CITATIONS, SYSTEM_PROMPT, _has_citation, _strip_unsupported_citations
from .vectors import VectorHit, vector_search

log = logging.getLogger(__name__)

USE_LANGCHAIN  = os.environ.get("DOCBRAIN_USE_LANGCHAIN", "0") in ("1", "true", "yes")
USE_MULTIQUERY = os.environ.get("DOCBRAIN_USE_MULTIQUERY", "1") in ("1", "true", "yes")
USE_HYBRID     = os.environ.get("DOCBRAIN_USE_HYBRID", "1") in ("1", "true", "yes")
VECTOR_BACKEND = os.environ.get("DOCBRAIN_VECTOR_BACKEND", "sqlite").lower()


class DocBrainRetriever(BaseRetriever):
    """Adapts `vector_search` to LangChain's BaseRetriever.

    Backend picked at runtime by DOCBRAIN_VECTOR_BACKEND:
      - sqlite (default) → our custom sqlite-vec store (vectors.py)
      - chroma           → Chroma, persisted under storage/chroma

    Returned `Document.metadata` carries `document_id`, `chunk_index`, and
    `distance` so the downstream chain can produce citations identically.
    """

    k: int = 6
    tenant_id: Optional[str] = None
    document_id: Optional[int] = None

    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> List[Document]:
        if VECTOR_BACKEND == "chroma":
            return _chroma_search(
                query=query,
                k=self.k,
                tenant_id=self.tenant_id,
                document_id=self.document_id,
            )
        kwargs: Dict = {"k": self.k}
        if self.tenant_id:
            kwargs["tenant_id"] = self.tenant_id
        if self.document_id is not None:
            kwargs["document_id"] = self.document_id
        hits: List[VectorHit] = vector_search(query, **kwargs)
        return [
            Document(
                page_content=h.text,
                metadata={
                    "document_id": h.document_id,
                    "chunk_index": h.chunk_index,
                    "distance": h.distance,
                },
            )
            for h in hits
        ]


# ---------- Chroma backend -------------------------------------------------

def _chroma_search(
    *,
    query: str,
    k: int,
    tenant_id: Optional[str],
    document_id: Optional[int],
) -> List[Document]:
    """Alternative retrieval backed by Chroma. Collection is populated
    lazily: on first query we import every chunk from the sqlite-vec store
    so both backends return the same results. Use this when you want the
    LangChain ecosystem around vectors (e.g. swapping embed models, cloud
    deploys, multi-tenant collections).
    """
    col = _chroma_collection()
    where: Dict = {}
    # Chroma where clauses require explicit equality on metadata keys.
    if document_id is not None:
        where["document_id"] = document_id
    if tenant_id:
        where["tenant_id"] = tenant_id
    from langchain_ollama import OllamaEmbeddings
    emb = OllamaEmbeddings(model=os.environ.get("DOCBRAIN_EMBED", "nomic-embed-text"),
                           base_url=OLLAMA_HOST)
    qvec = emb.embed_query(query)
    try:
        res = col.query(
            query_embeddings=[qvec],
            n_results=k,
            where=where or None,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("chroma query failed: %s", exc)
        return []
    ids       = (res.get("ids") or [[]])[0]
    docs      = (res.get("documents") or [[]])[0]
    metadatas = (res.get("metadatas") or [[]])[0]
    distances = (res.get("distances") or [[]])[0]
    out: List[Document] = []
    for i, rid in enumerate(ids):
        md = metadatas[i] if i < len(metadatas) else {}
        out.append(
            Document(
                page_content=docs[i] if i < len(docs) else "",
                metadata={
                    "document_id": int(md.get("document_id", 0)),
                    "chunk_index": int(md.get("chunk_index", 0)),
                    "distance":    float(distances[i]) if i < len(distances) else 0.0,
                    "source_id":   rid,
                },
            )
        )
    return out


_chroma_col_cache = {"col": None, "hydrated": False}


def _chroma_collection():
    """Return (and lazily create) a Chroma collection. On first access we
    hydrate it from the sqlite-vec store so switching backends doesn't
    empty retrieval."""
    if _chroma_col_cache["col"] is not None and _chroma_col_cache["hydrated"]:
        return _chroma_col_cache["col"]

    import chromadb
    persist = os.environ.get("DOCBRAIN_CHROMA_DIR", "./storage/chroma")
    client = chromadb.PersistentClient(path=persist)
    col = client.get_or_create_collection("docbrain_chunks")
    _chroma_col_cache["col"] = col

    # Hydrate once if empty.
    if col.count() == 0:
        _hydrate_chroma_from_sqlite(col)
    _chroma_col_cache["hydrated"] = True
    return col


def _hydrate_chroma_from_sqlite(col) -> int:
    """One-shot import of existing sqlite-vec chunks into Chroma so the
    first query against the chroma backend doesn't return empty."""
    import sqlite3
    from pathlib import Path
    db_path = Path(os.environ.get("DOCBRAIN_DB", "./storage/docbrain.sqlite"))
    if not db_path.exists():
        return 0

    conn = sqlite3.connect(str(db_path))
    rows = conn.execute(
        "SELECT tenant_id, document_id, chunk_index, text FROM docbrain_chunks"
    ).fetchall()
    conn.close()
    if not rows:
        return 0

    from langchain_ollama import OllamaEmbeddings
    emb = OllamaEmbeddings(model=os.environ.get("DOCBRAIN_EMBED", "nomic-embed-text"),
                           base_url=OLLAMA_HOST)

    ids: List[str] = []
    texts: List[str] = []
    metas: List[Dict] = []
    vectors: List[List[float]] = []
    for r in rows:
        tenant, doc_id, chunk_idx, text = r
        vec = emb.embed_query(text)
        if not vec:
            continue
        ids.append(f"{tenant}-{doc_id}-{chunk_idx}")
        texts.append(text)
        metas.append({"tenant_id": tenant, "document_id": int(doc_id), "chunk_index": int(chunk_idx)})
        vectors.append(vec)
    if not ids:
        return 0
    col.add(ids=ids, documents=texts, metadatas=metas, embeddings=vectors)
    log.info("chroma: hydrated %s chunks from sqlite-vec", len(ids))
    return len(ids)


# ---------- hybrid reranker ------------------------------------------------

def _hybrid_rerank(query: str, docs: List[Document], top_k: int = 6) -> List[Document]:
    """Re-rank the merged candidate pool by combining cosine distance
    (embedding-based) with BM25 score (lexical). Pulls up results that
    are semantically close *and* share literal tokens with the query —
    helps dodge the cosine-only false positives ("dummy" chunks with the
    same overall topic but no real overlap).

    Both scores are normalised to [0, 1]; we average (0.6 cosine, 0.4 bm25).
    """
    if not docs:
        return []
    if len(docs) == 1:
        return docs[: top_k]

    # Normalise cosine distance → similarity
    dists = [float(d.metadata.get("distance", 0.0)) for d in docs]
    dmin, dmax = min(dists), max(dists)
    spread = (dmax - dmin) or 1.0
    cos_sim = [1.0 - (d - dmin) / spread for d in dists]

    # BM25 over the candidate pool itself.
    def tokens(text: str) -> List[str]:
        return [t.lower() for t in text.split() if t.strip()]

    corpus = [tokens(d.page_content) for d in docs]
    bm = BM25Okapi(corpus)
    bm_raw = bm.get_scores(tokens(query))
    bmin, bmax = float(min(bm_raw)), float(max(bm_raw))
    bspread = (bmax - bmin) or 1.0
    bm_norm = [(float(s) - bmin) / bspread for s in bm_raw]

    fused = [0.6 * cos_sim[i] + 0.4 * bm_norm[i] for i in range(len(docs))]
    order = sorted(range(len(docs)), key=lambda i: fused[i], reverse=True)[: top_k]
    # Attach the fused score so callers/tests can inspect it.
    ranked: List[Document] = []
    for i in order:
        doc = docs[i]
        meta = dict(doc.metadata)
        meta["rerank_score"] = round(fused[i], 4)
        ranked.append(Document(page_content=doc.page_content, metadata=meta))
    return ranked


def _dedup_docs(docs: List[Document]) -> List[Document]:
    """Multi-query retriever can return the same chunk multiple times;
    dedupe by (document_id, chunk_index)."""
    seen: set = set()
    out: List[Document] = []
    for d in docs:
        key = (d.metadata.get("document_id"), d.metadata.get("chunk_index"))
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


def build_retriever(
    *,
    tenant_id: Optional[str] = None,
    document_id: Optional[int] = None,
    k: int = 6,
) -> "BaseRetriever":
    """Compose the layered retrieval pipeline according to feature flags."""
    base = DocBrainRetriever(k=k, tenant_id=tenant_id, document_id=document_id)
    if not USE_MULTIQUERY:
        return base
    llm = OllamaLLM(model=CHAT_MODEL, base_url=OLLAMA_HOST, temperature=0.2)
    return MultiQueryRetriever.from_llm(retriever=base, llm=llm, include_original=True)


def _build_prompt(system: str, passages: List[Document], question: str) -> str:
    """Render the numbered passage block exactly like rag.py does so the
    LLM sees the same context shape + [^N] markers either way."""
    parts = []
    for i, d in enumerate(passages[:MAX_CITATIONS], start=1):
        did = d.metadata.get("document_id")
        cix = d.metadata.get("chunk_index")
        parts.append(f"[{i}] (doc={did} chunk={cix})\n{d.page_content.strip()}")
    context = "\n\n".join(parts)
    user = (
        f"PASSAGES:\n\n{context}\n\n"
        f"QUESTION: {question.strip()}\n\n"
        "Answer using only the numbered passages above, with inline [^N] citations."
    )
    return f"{system}\n\n{user}"


def rag_answer_stream_langchain(
    question: str,
    *,
    tenant_id: Optional[str] = None,
    document_id: Optional[int] = None,
    history: Optional[List[Dict[str, str]]] = None,
    k: int = 6,
) -> Iterator[Dict]:
    """Drop-in streaming generator with the same event shape as
    `docbrain.rag.rag_answer_stream`, but built on LangChain primitives.
    """
    if not question or not question.strip():
        yield {"type": "no_evidence", "message": "Please ask a question."}
        return

    # Pull candidates (potentially via MultiQueryRetriever) then rerank.
    # We ask the retriever for more candidates than we'll show so the
    # reranker has something to work with.
    candidate_k = max(k * 3, 12) if USE_HYBRID else k
    retriever = build_retriever(
        tenant_id=tenant_id,
        document_id=document_id,
        k=candidate_k,
    )
    try:
        candidates: List[Document] = retriever.invoke(question)
    except Exception as exc:  # noqa: BLE001
        log.exception("langchain retriever failed: %s", exc)
        yield {"type": "error", "message": str(exc)[:200]}
        return

    candidates = _dedup_docs(candidates)
    docs = _hybrid_rerank(question, candidates, top_k=k) if USE_HYBRID else candidates[: k]

    if not docs:
        yield {
            "type": "no_evidence",
            "message": (
                "I could not find supporting passages in the indexed documents. "
                "Try uploading or re-analysing the document first, or rephrasing "
                "your question."
            ),
        }
        return

    citations = [
        {
            "document_id": int(d.metadata.get("document_id", 0)),
            "chunk_index": int(d.metadata.get("chunk_index", 0)),
            "snippet": d.page_content[:800],
        }
        for d in docs[:MAX_CITATIONS]
    ]
    yield {"type": "citations", "items": citations}

    # Build the prompt and stream tokens via the LangChain LLM wrapper.
    # Keeping the history flat: prepend prior turns as plain text so we stay
    # on the unified-prompt path (simpler than juggling a chat-format model).
    history_text = ""
    for turn in (history or [])[-6:]:
        role = turn.get("role") or ""
        content = turn.get("content") or ""
        if role and content:
            history_text += f"\n\n{role.upper()}: {content}"
    sys_plus_hist = SYSTEM_PROMPT + (history_text if history_text else "")
    prompt = _build_prompt(sys_plus_hist, docs, question)

    llm = OllamaLLM(
        model=CHAT_MODEL,
        base_url=OLLAMA_HOST,
        temperature=0.1,
    )

    collected: List[str] = []
    try:
        for chunk in llm.stream(prompt):
            # langchain-ollama yields str tokens directly.
            if isinstance(chunk, str) and chunk:
                collected.append(chunk)
                yield {"type": "token", "text": chunk}
    except Exception as exc:  # noqa: BLE001
        log.exception("langchain stream failed: %s", exc)
        yield {"type": "error", "message": str(exc)[:200]}
        return

    raw = "".join(collected)
    raw = _strip_unsupported_citations(raw, available=len(citations))
    has_evidence = bool(raw)
    needs_verification = has_evidence and not _has_citation(raw)
    yield {
        "type": "done",
        "has_evidence": has_evidence,
        "needs_verification": needs_verification,
    }

"""RAG — hybrid retrieval + grounded answer with mandatory citations.

No citation → no answer. This is the non-negotiable guardrail from
AI_STRATEGY.md §6: the product does not surface AI text it can't trace.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .llm import chat_text
from .vectors import VectorHit, vector_search

log = logging.getLogger(__name__)

MAX_CITATIONS = 5
MAX_CONTEXT_CHARS = 6000


@dataclass
class Citation:
    document_id: int
    chunk_index: int
    snippet: str          # the passage the answer draws from


@dataclass
class RagAnswer:
    answer: str
    citations: List[Citation]
    has_evidence: bool    # false → we refused to answer, UI shows a notice


SYSTEM_PROMPT = """You are DocBrain, an answer-grounding assistant for a bank's
document management system.

Rules:
  1. Answer using ONLY the numbered passages below. Do not use outside knowledge.
  2. Every factual claim MUST cite at least one passage as [^N] where N is the
     passage number.
  3. If the passages don't contain enough information, say so honestly — do
     NOT guess.
  4. Be concise. Prefer short, structured answers.
  5. Do not fabricate dates, names, IDs, or amounts.

Format:
  - Plain-text answer with inline citations like [^1] [^2].
  - No markdown tables or code blocks unless directly quoting from a passage.
"""

_CITE_RE = re.compile(r"\[\^(\d+)\]")


def _build_context(hits: List[VectorHit]) -> Tuple[str, List[Citation]]:
    """
    Format retrieved passages as a numbered block; return the context string
    and the citation index the LLM will reference.
    """
    citations: List[Citation] = []
    parts: List[str] = []
    used_chars = 0
    for i, h in enumerate(hits[:MAX_CITATIONS], start=1):
        # Trim long chunks so one document doesn't swallow the budget
        snippet = h.text.strip()
        if used_chars + len(snippet) > MAX_CONTEXT_CHARS:
            snippet = snippet[: max(0, MAX_CONTEXT_CHARS - used_chars)]
        if not snippet:
            break
        used_chars += len(snippet)
        parts.append(f"[{i}] (doc={h.document_id} chunk={h.chunk_index})\n{snippet}")
        citations.append(Citation(
            document_id=h.document_id,
            chunk_index=h.chunk_index,
            snippet=snippet,
        ))
    return "\n\n".join(parts), citations


def _strip_unsupported_citations(
    answer: str,
    available: int,
) -> str:
    """
    If the model cites a passage number that doesn't exist, strip it.
    Better to show an answer with fewer citations than one with fake ones.
    """
    def repl(match: re.Match) -> str:
        n = int(match.group(1))
        return match.group(0) if 1 <= n <= available else ""
    return _CITE_RE.sub(repl, answer).strip()


def _has_citation(answer: str) -> bool:
    return bool(_CITE_RE.search(answer))


def rag_answer(
    question: str,
    *,
    tenant_id: Optional[str] = None,
    document_id: Optional[int] = None,
    k: int = 6,
) -> RagAnswer:
    """
    End-to-end RAG. If scoped to a single document, all passages come from
    that document; otherwise we fan out across the tenant's indexed corpus.
    """
    if not question or not question.strip():
        return RagAnswer(answer="Please ask a question.", citations=[],
                         has_evidence=False)

    kwargs: Dict = {"k": k}
    if tenant_id:   kwargs["tenant_id"] = tenant_id
    if document_id is not None: kwargs["document_id"] = document_id
    hits = vector_search(question, **kwargs)

    if not hits:
        return RagAnswer(
            answer=(
                "I could not find supporting passages in the indexed documents. "
                "Try uploading or re-analysing the document first, or rephrasing "
                "your question."
            ),
            citations=[],
            has_evidence=False,
        )

    context, citations = _build_context(hits)
    user_prompt = (
        f"PASSAGES:\n\n{context}\n\n"
        f"QUESTION: {question.strip()}\n\n"
        "Answer using only the numbered passages above, with inline [^N] citations."
    )
    raw = chat_text(SYSTEM_PROMPT, user_prompt, temperature=0.1)
    raw = _strip_unsupported_citations(raw, available=len(citations))

    if not raw:
        return RagAnswer(
            answer="The model did not return an answer. Please retry.",
            citations=citations,
            has_evidence=False,
        )

    if not _has_citation(raw):
        # Enforce the no-citation-no-display rule — surface a bounded error
        # instead of pretending the answer is grounded.
        return RagAnswer(
            answer=(
                "I drafted an answer but could not cite a supporting passage, so "
                "I am holding it back. Please rephrase or provide more context."
            ),
            citations=citations,
            has_evidence=False,
        )

    return RagAnswer(answer=raw, citations=citations, has_evidence=True)

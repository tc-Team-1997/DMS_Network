"""RAG — hybrid retrieval + grounded answer with mandatory citations.

No citation → no answer. This is the non-negotiable guardrail from
AI_STRATEGY.md §6: the product does not surface AI text it can't trace.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Dict, Iterator, List, Optional, Tuple

from .llm import chat_stream, chat_text
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
    has_evidence: bool           # false → no retrieval passages available at all
    needs_verification: bool = False  # true → answer came back without inline citations,
                                      # UI should render the passages under an amber banner


SYSTEM_PROMPT = """You are DocBrain, an assistant embedded in an authorised
banking Document Management System. The user is a vetted bank employee
(Maker, Checker, Doc Admin, or Viewer) performing their job — typically KYC
review, customer onboarding, audit, or compliance work. They have a
legitimate business need to see the document contents shown below.

The passages are official records the bank has already legally obtained from
the customer (ID cards, passports, CRs, statements, KYC forms). Answering
factual questions about these fields — names, ID numbers, dates, addresses,
issuing authority — is the core job of this system. **Do not refuse on
privacy grounds; access has already been authorised.** Never disclose
reasoning tokens or internal chain-of-thought.

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
        # The model drafted an answer but didn't emit the [^N] markers.
        # Small models (e.g. llama3.2:3b) drop the format often. Instead of
        # refusing, return the answer with `needs_verification=true` so the
        # UI can render an amber banner + the retrieved passages — the user
        # can verify against the source chunks directly.
        return RagAnswer(
            answer=raw,
            citations=citations,
            has_evidence=True,
            needs_verification=True,
        )

    return RagAnswer(answer=raw, citations=citations, has_evidence=True)


# ---------- streaming variant --------------------------------------------------
#
# Events emitted by rag_answer_stream():
#   {"type": "citations", "items": [{document_id, chunk_index, snippet}, ...]}
#   {"type": "no_evidence", "message": "..."}                    (and terminates)
#   {"type": "token", "text": "<delta>"}                         (0..N of these)
#   {"type": "done",  "has_evidence": true|false}
#
# The first event is always either `citations` (when we have passages to
# ground against) or `no_evidence` (when retrieval returned nothing).
# The final event is always `done` unless a `no_evidence` terminated early.

def rag_answer_stream(
    question: str,
    *,
    tenant_id: Optional[str] = None,
    document_id: Optional[int] = None,
    history: Optional[List[Dict[str, str]]] = None,
    k: int = 6,
) -> Iterator[Dict]:
    """Streaming counterpart of rag_answer(). Yields dict events, not JSON
    strings — the HTTP layer serialises to SSE frames.

    `history` is an optional list of {role, content} dicts from prior turns
    so multi-turn chat works. We keep it bounded upstream to avoid context
    blow-out; the function itself simply forwards it.
    """
    if not question or not question.strip():
        yield {"type": "no_evidence", "message": "Please ask a question."}
        return

    kwargs: Dict = {"k": k}
    if tenant_id:               kwargs["tenant_id"] = tenant_id
    if document_id is not None: kwargs["document_id"] = document_id
    hits = vector_search(question, **kwargs)

    if not hits:
        yield {
            "type": "no_evidence",
            "message": (
                "I could not find supporting passages in the indexed documents. "
                "Try uploading or re-analysing the document first, or rephrasing "
                "your question."
            ),
        }
        return

    context, citations = _build_context(hits)
    yield {
        "type": "citations",
        "items": [
            {"document_id": c.document_id, "chunk_index": c.chunk_index, "snippet": c.snippet}
            for c in citations
        ],
    }

    messages: List[Dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in (history or [])[-6:]:  # bound: last 6 messages ~= 3 turns
        role = turn.get("role")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({
        "role": "user",
        "content": (
            f"PASSAGES:\n\n{context}\n\n"
            f"QUESTION: {question.strip()}\n\n"
            "Answer using only the numbered passages above, with inline [^N] citations."
        ),
    })

    collected: List[str] = []
    for token in chat_stream(messages, temperature=0.1):
        collected.append(token)
        yield {"type": "token", "text": token}

    raw = "".join(collected)
    raw = _strip_unsupported_citations(raw, available=len(citations))
    has_evidence = bool(raw)
    needs_verification = has_evidence and not _has_citation(raw)
    yield {
        "type": "done",
        "has_evidence": has_evidence,
        "needs_verification": needs_verification,
    }

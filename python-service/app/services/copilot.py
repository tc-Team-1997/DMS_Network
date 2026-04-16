"""DMS Copilot — RAG over documents + structured-query shortcuts.

Two answer paths, auto-selected per query:
  1. **Structured**: regex-match natural-language patterns like
        "expired passports in Cairo West"
        "how many kyc docs for EGY-2024-00847291?"
     → translate to SQL/ORM query → deterministic answer + source rows.
  2. **RAG**: fall back to vector search → stitch top-k snippets as context →
     ask an LLM to answer. LLM is optional: if ANTHROPIC_API_KEY or OPENAI_API_KEY
     is set we call it; otherwise we return a templated extractive answer so the
     API never hard-depends on an external provider.
"""
from __future__ import annotations
import os
import re
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Document, OcrResult
from ..services import vector as vec


EXPIRED_RE = re.compile(r"\bexpired\b", re.I)
EXPIRING_RE = re.compile(r"\bexpir(?:ing|es?)\b|\bexpiry\b", re.I)
COUNT_RE = re.compile(r"\b(how many|count)\b", re.I)
BRANCH_RE = re.compile(r"\b(?:in|at|for)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})", re.I)
DOC_TYPE_RE = re.compile(r"\b(passport|national[\s_-]?id|utility\s*bill|loan|contract|kyc)\b", re.I)
CID_RE = re.compile(r"\b([A-Z]{2,4}-\d{4}-\d{4,12})\b")


def _normalize_doc_type(s: str) -> str:
    s = s.lower().strip().replace(" ", "_").replace("-", "_")
    if "kyc" in s:
        return "passport"   # shorthand — routed to most common KYC doc
    if "national" in s:
        return "national_id"
    if "utility" in s:
        return "utility_bill"
    if "loan" in s:
        return "loan_application"
    return s


def _structured_answer(db: Session, q: str, tenant: str, branch_scope: str | None) -> dict | None:
    ql = q.lower()

    filters = []
    m = DOC_TYPE_RE.search(q)
    if m:
        filters.append(Document.doc_type == _normalize_doc_type(m.group(1)))
    m = BRANCH_RE.search(q)
    scoped_branch = branch_scope or (m.group(1).title() if m else None)
    if scoped_branch:
        filters.append(Document.branch.ilike(f"%{scoped_branch}%"))
    m = CID_RE.search(q)
    if m:
        filters.append(Document.customer_cid == m.group(1))

    base = db.query(Document).filter(Document.tenant == tenant, *filters)

    if EXPIRED_RE.search(ql):
        from datetime import datetime
        today = datetime.utcnow().date().isoformat()
        base = base.filter(Document.expiry_date < today, Document.expiry_date != None)  # noqa: E711
    elif EXPIRING_RE.search(ql):
        from datetime import datetime, timedelta
        today = datetime.utcnow().date()
        cutoff = (today + timedelta(days=30)).isoformat()
        base = base.filter(Document.expiry_date <= cutoff, Document.expiry_date >= today.isoformat())

    if COUNT_RE.search(ql):
        n = base.with_entities(func.count(Document.id)).scalar() or 0
        return {"kind": "count", "answer": f"{n} document(s) match.", "count": int(n)}

    rows = base.order_by(Document.id.desc()).limit(10).all()
    if rows:
        sample = ", ".join(f"#{d.id} {d.original_name}" for d in rows[:5])
        suffix = "" if len(rows) < 10 else " (showing 10)"
        return {
            "kind": "list",
            "answer": f"{len(rows)} result(s){suffix}: {sample}",
            "documents": [{"id": d.id, "original_name": d.original_name,
                           "doc_type": d.doc_type, "branch": d.branch,
                           "expiry_date": d.expiry_date, "status": d.status} for d in rows],
        }
    return None


def _llm_answer(question: str, context: str) -> str | None:
    """Optional LLM call. Returns None if no provider configured/available."""
    prompt = (
        "You are the NBE DMS assistant. Answer the question using only the context. "
        "If the answer is not in the context, say you don't know.\n\n"
        f"Context:\n{context}\n\nQuestion: {question}\nAnswer:"
    )
    # Anthropic
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            from anthropic import Anthropic
            client = Anthropic()
            msg = client.messages.create(
                model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
                max_tokens=400,
                messages=[{"role": "user", "content": prompt}],
            )
            return msg.content[0].text if msg.content else None
        except Exception:
            pass
    # OpenAI
    if os.environ.get("OPENAI_API_KEY"):
        try:
            from openai import OpenAI
            client = OpenAI()
            r = client.chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
            )
            return r.choices[0].message.content
        except Exception:
            pass
    return None


def _extractive_answer(question: str, snippets: list[str]) -> str:
    """Fallback — concatenate best snippets with the question as a leading marker."""
    if not snippets:
        return "I couldn't find anything relevant in indexed documents."
    joined = "\n— ".join(s[:240] for s in snippets[:3])
    return f"Based on {len(snippets)} indexed document(s):\n— {joined}"


def answer(db: Session, question: str, tenant: str, branch_scope: str | None,
           top_k: int = 5) -> dict[str, Any]:
    # 1) Try structured match first — always deterministic.
    structured = _structured_answer(db, question, tenant, branch_scope)
    if structured:
        return {"mode": "structured", **structured}

    # 2) RAG fallback.
    hits = vec.search(question, top_k=top_k)
    snippets: list[str] = []
    sources: list[dict] = []
    for h in hits:
        doc = db.get(Document, h["document_id"])
        if not doc or doc.tenant != tenant:
            continue
        if branch_scope and doc.branch and doc.branch != branch_scope:
            continue
        ocr = db.query(OcrResult).filter(OcrResult.document_id == doc.id).first()
        text = (ocr.text if ocr else "") or doc.original_name
        snippets.append(f"[#{doc.id} {doc.original_name}]: {text[:600]}")
        sources.append({
            "document_id": doc.id, "original_name": doc.original_name,
            "score": round(h["score"], 4),
        })

    context = "\n\n".join(snippets)
    llm = _llm_answer(question, context) if snippets else None
    if llm:
        return {"mode": "rag_llm", "answer": llm, "sources": sources}
    return {"mode": "rag_extractive", "answer": _extractive_answer(question, snippets),
            "sources": sources}

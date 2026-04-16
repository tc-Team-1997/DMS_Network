"""Loan-file summarization: collect all docs for a CID → concise brief.

Three tiers, auto-selected:
  1. Claude (ANTHROPIC_API_KEY)  — highest quality
  2. OpenAI (OPENAI_API_KEY)     — fallback
  3. Extractive summarizer       — no external dep; picks top sentences by TF-IDF-like scoring
"""
from __future__ import annotations
import os
import re
from collections import Counter
from datetime import datetime
from sqlalchemy.orm import Session

from ..models import Document, OcrResult, EFormSubmission


PROMPT_HEADER = (
    "You are a loan underwriter assistant at National Bank of Egypt. Read the document "
    "extracts below and produce a 1-page brief with these sections:\n"
    "  ### Applicant\n"
    "  ### Documents on file\n"
    "  ### Red flags\n"
    "  ### Completeness checklist\n"
    "  ### Recommendation\n"
    "Be specific, cite document IDs in square brackets [#id], and keep it under 400 words."
)


def _gather_corpus(db: Session, customer_cid: str) -> tuple[str, list[dict]]:
    docs = db.query(Document).filter(Document.customer_cid == customer_cid).all()
    meta = []
    chunks = []
    for d in docs:
        ocr = db.query(OcrResult).filter(OcrResult.document_id == d.id).first()
        text = (ocr.text if ocr else "") or ""
        m = {
            "id": d.id, "doc_type": d.doc_type, "branch": d.branch,
            "status": d.status, "expiry_date": d.expiry_date,
            "ocr_confidence": float(ocr.confidence) if ocr and ocr.confidence is not None else None,
            "original_name": d.original_name,
        }
        meta.append(m)
        header = f"[#{d.id} {d.doc_type or 'doc'} / {d.branch or '-'} / expiry={d.expiry_date or '-'}]"
        chunks.append(f"{header}\n{text[:1200]}")

    # Attach e-form data too (structured = highest-signal context).
    forms = db.query(EFormSubmission).filter(EFormSubmission.customer_cid == customer_cid).all()
    for f in forms:
        import json as _json
        data = _json.loads(f.data_json or "{}")
        kv = ", ".join(f"{k}={v}" for k, v in data.items())
        chunks.append(f"[eform #{f.id} form_id={f.form_id}] {kv}")

    return ("\n\n".join(chunks), meta)


def _llm_summary(prompt_body: str) -> str | None:
    full = PROMPT_HEADER + "\n\n" + prompt_body

    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            from anthropic import Anthropic
            client = Anthropic()
            msg = client.messages.create(
                model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
                max_tokens=800,
                messages=[{"role": "user", "content": full}],
            )
            return msg.content[0].text if msg.content else None
        except Exception:
            pass
    if os.environ.get("OPENAI_API_KEY"):
        try:
            from openai import OpenAI
            client = OpenAI()
            r = client.chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": full}],
                max_tokens=800,
            )
            return r.choices[0].message.content
        except Exception:
            pass
    return None


# ─────────── Extractive fallback ───────────
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")
_STOP = set("""the a an and or of to in for on with as by is are was were be been being this that
these those at from but not no yes if then than so it its""".split())


def _extractive(chunks: list[str], meta: list[dict], customer_cid: str) -> str:
    text = "\n".join(chunks)
    sentences = _SENT_SPLIT.split(text)
    words = [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z-]{2,}", text)]
    freq = Counter(w for w in words if w not in _STOP)
    scored: list[tuple[float, str]] = []
    for s in sentences:
        sw = [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z-]{2,}", s)]
        if not sw:
            continue
        score = sum(freq.get(w, 0) for w in sw) / (len(sw) ** 0.5)
        scored.append((score, s.strip()))
    scored.sort(reverse=True)
    top = [s for _, s in scored[:8]]

    lines = [f"### Applicant",
             f"Customer CID: {customer_cid}",
             "",
             f"### Documents on file ({len(meta)})"]
    for m in meta[:20]:
        lines.append(f"- [#{m['id']}] {m['doc_type'] or '—'} · "
                     f"{m['branch'] or '—'} · expiry={m['expiry_date'] or '—'} · "
                     f"status={m['status']}")

    red_flags = []
    for m in meta:
        if m["expiry_date"] and m["expiry_date"] < datetime.utcnow().date().isoformat():
            red_flags.append(f"- [#{m['id']}] {m['doc_type']} expired ({m['expiry_date']})")
        if m["ocr_confidence"] is not None and m["ocr_confidence"] < 0.85:
            red_flags.append(f"- [#{m['id']}] low OCR confidence ({m['ocr_confidence']:.2f})")
    lines += ["", "### Red flags"] + (red_flags or ["- none detected"])

    types = {m["doc_type"] for m in meta if m["doc_type"]}
    required = {"passport", "utility_bill", "loan_application"}
    lines += ["", "### Completeness checklist"]
    for r in required:
        mark = "✅" if r in types else "❌"
        lines.append(f"- {mark} {r}")

    lines += ["", "### Key excerpts"] + [f"> {s[:240]}" for s in top[:4]]
    lines += ["", "### Recommendation",
              "Extractive summary — no LLM configured. Review manually before final decision."]
    return "\n".join(lines)


def summarize_loan_file(db: Session, customer_cid: str) -> dict:
    corpus, meta = _gather_corpus(db, customer_cid)
    if not meta:
        return {"customer_cid": customer_cid, "mode": "empty",
                "summary": "No documents on file for this customer."}
    llm = _llm_summary(corpus)
    if llm:
        return {"customer_cid": customer_cid, "mode": "llm",
                "summary": llm, "document_ids": [m["id"] for m in meta]}
    return {"customer_cid": customer_cid, "mode": "extractive",
            "summary": _extractive(corpus.split("\n\n"), meta, customer_cid),
            "document_ids": [m["id"] for m in meta]}

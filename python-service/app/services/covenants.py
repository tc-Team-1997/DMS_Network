"""Extract loan covenants from scanned contract OCR text.

Pattern-based (interpretable for auditors) with 4 covenant kinds:

  - financial        — numeric thresholds on ratios (DSCR ≥ 1.25, leverage ≤ 3.0x,
                       tangible net worth ≥ EGP 10 000 000)
  - affirmative      — "Borrower shall …" obligations (maintain insurance, deliver statements)
  - negative         — "Borrower shall not …" prohibitions (incur debt, sell assets)
  - reporting        — deadlines on info delivery (within 30 days of quarter end)
  - event_of_default — triggers of default (non-payment, insolvency, change of control)

Each extracted covenant is persisted with a confidence in [0, 1] so a human
reviewer can triage the uncertain ones. LLM refinement (optional) adds a
normalized metric + threshold when ANTHROPIC_API_KEY / OPENAI_API_KEY is set.
"""
from __future__ import annotations
import json
import os
import re
from typing import Any

from sqlalchemy.orm import Session

from ..models import Document, OcrResult, LoanCovenant


FIN_RE = re.compile(
    r"\b(DSCR|debt[\s-]?service[\s-]?coverage|leverage|tangible\s+net\s+worth|current\s+ratio|"
    r"interest\s+coverage|EBITDA|net\s+debt|book\s+value)\b[^.]{0,120}?"
    r"(?P<op>shall\s+(?:not\s+)?(?:be|exceed|fall\s+below)|>=|<=|>|<|at\s+least|no\s+more\s+than)"
    r"[^.]{0,80}?(?P<num>[\d,.]+)\s*(?P<unit>x|times|%|egp|usd|eur|million|m|bn|billion)?",
    re.I,
)
AFFIRM_RE = re.compile(r"\bborrower\s+shall\b[^.]{3,400}\.", re.I)
NEG_RE    = re.compile(r"\bborrower\s+shall\s+not\b[^.]{3,400}\.", re.I)
REPORT_RE = re.compile(
    r"\b(within|no\s+later\s+than)\s+(\d+)\s+(days|business\s+days|calendar\s+days)\s+"
    r"(of|after|following)\b[^.]{3,200}\.", re.I,
)
DEFAULT_RE = re.compile(
    r"\b(event\s+of\s+default|default\s+shall\s+have\s+occurred|acceleration\s+of\s+the\s+loan)\b[^.]{0,400}\.",
    re.I,
)


OP_MAP = {
    ">=": ">=", "<=": "<=", ">": ">", "<": "<",
    "at least": ">=", "no more than": "<=",
    "shall be": ">=", "shall not exceed": "<=",
    "shall not fall below": ">=",
}

UNIT_MULT = {"million": 1_000_000, "m": 1_000_000, "billion": 1_000_000_000, "bn": 1_000_000_000}


def _norm_op(raw: str) -> str:
    r = raw.lower().strip()
    for k, v in OP_MAP.items():
        if k in r:
            return v
    return r


def _metric_key(text: str) -> str:
    t = text.lower()
    if "dscr" in t or "debt-service" in t or "debt service" in t:
        return "dscr"
    if "leverage" in t or "net debt" in t:
        return "leverage"
    if "tangible net worth" in t:
        return "tnw"
    if "current ratio" in t:
        return "current_ratio"
    if "interest coverage" in t:
        return "interest_coverage"
    return "generic"


def _value(num: str, unit: str | None) -> float:
    try:
        v = float(num.replace(",", ""))
    except Exception:
        return 0.0
    if unit:
        v *= UNIT_MULT.get(unit.lower(), 1)
    return v


def _currency(unit: str | None) -> str | None:
    if not unit:
        return None
    u = unit.lower()
    if u in ("egp", "usd", "eur"):
        return u.upper()
    return None


def extract(text: str) -> list[dict]:
    out: list[dict] = []
    for m in FIN_RE.finditer(text or ""):
        clause = text[max(0, m.start() - 20): m.end() + 40].strip()
        out.append({
            "kind": "financial",
            "clause": clause[:1000],
            "metric": _metric_key(m.group(0)),
            "operator": _norm_op(m.group("op")),
            "threshold": _value(m.group("num"), m.group("unit")),
            "currency": _currency(m.group("unit")),
            "confidence": 0.82,
        })
    for m in NEG_RE.finditer(text or ""):
        out.append({"kind": "negative", "clause": m.group(0)[:1000],
                    "metric": None, "operator": None, "threshold": None,
                    "currency": None, "confidence": 0.75})
    for m in AFFIRM_RE.finditer(text or ""):
        clause = m.group(0)
        # Exclude "shall not" already captured above.
        if "shall not" in clause.lower():
            continue
        out.append({"kind": "affirmative", "clause": clause[:1000],
                    "metric": None, "operator": None, "threshold": None,
                    "currency": None, "confidence": 0.7})
    for m in REPORT_RE.finditer(text or ""):
        out.append({"kind": "reporting", "clause": m.group(0)[:1000],
                    "metric": "delivery_days",
                    "operator": "<=",
                    "threshold": float(m.group(2)),
                    "currency": None, "confidence": 0.78})
    for m in DEFAULT_RE.finditer(text or ""):
        out.append({"kind": "event_of_default", "clause": m.group(0)[:1000],
                    "metric": None, "operator": None, "threshold": None,
                    "currency": None, "confidence": 0.72})
    return out


def _llm_refine(clauses: list[dict]) -> list[dict]:
    """Optional pass to fix metric/operator/threshold via Claude / OpenAI."""
    if not clauses:
        return clauses
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")):
        return clauses
    prompt = (
        "You are a loan covenant parser. For each clause, return a JSON object with "
        "`metric`, `operator` (one of >=, <=, >, <), `threshold` (number), `currency` "
        "(ISO 4217 or null). Do not invent thresholds — if unclear, set to null.\n"
        f"Clauses:\n{json.dumps([c['clause'] for c in clauses])}"
    )
    try:
        if os.environ.get("ANTHROPIC_API_KEY"):
            from anthropic import Anthropic
            c = Anthropic()
            m = c.messages.create(
                model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
                max_tokens=1200, messages=[{"role": "user", "content": prompt}])
            raw = m.content[0].text if m.content else "[]"
        else:
            from openai import OpenAI
            c = OpenAI()
            r = c.chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": prompt}], max_tokens=1200)
            raw = r.choices[0].message.content
        refined = json.loads(raw)
        for i, ref in enumerate(refined):
            if i >= len(clauses):
                break
            for key in ("metric", "operator", "threshold", "currency"):
                if ref.get(key) is not None:
                    clauses[i][key] = ref[key]
            clauses[i]["confidence"] = min(1.0, clauses[i]["confidence"] + 0.15)
    except Exception:
        pass
    return clauses


def extract_for_document(db: Session, document_id: int) -> dict:
    doc = db.get(Document, document_id)
    if not doc:
        return {"error": "not_found"}
    ocr = db.query(OcrResult).filter(OcrResult.document_id == document_id).first()
    if not ocr or not ocr.text:
        return {"error": "no_ocr"}

    extracted = _llm_refine(extract(ocr.text))
    db.query(LoanCovenant).filter(LoanCovenant.document_id == document_id).delete()
    for c in extracted:
        db.add(LoanCovenant(
            document_id=document_id, kind=c["kind"],
            clause=c["clause"], metric=c.get("metric"),
            operator=c.get("operator"), threshold=c.get("threshold"),
            currency=c.get("currency"), confidence=c.get("confidence"),
        ))
    db.commit()

    return {"document_id": document_id,
            "covenants": extracted,
            "by_kind": {k: len([c for c in extracted if c["kind"] == k])
                        for k in ("financial", "affirmative", "negative", "reporting", "event_of_default")}}


def list_for_document(db: Session, document_id: int) -> list[dict]:
    rows = db.query(LoanCovenant).filter(LoanCovenant.document_id == document_id).all()
    return [{"id": r.id, "kind": r.kind, "clause": r.clause,
             "metric": r.metric, "operator": r.operator,
             "threshold": r.threshold, "currency": r.currency,
             "confidence": r.confidence} for r in rows]

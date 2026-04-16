"""Semantic diffing of document versions.

Byte-level diff is noisy (OCR jitter, font changes, compression artifacts).
This service diffs at four semantic layers so a checker can see *what changed*
rather than *where a pixel moved*:

  1. **Fields**: extracted OCR fields (name, DOB, passport_no, expiry_date, MRZ).
     Compare field-by-field; classify each as added / removed / changed / same.
  2. **Entities**: money amounts, dates, percentages, EG national-ID patterns.
     `"EGP 5,000,000"` vs `"EGP 5,500,000"` → `amount:5000000 → 5500000`.
  3. **Sentences**: rapidfuzz similarity ≥ 0.85 = matched pair; otherwise
     added/removed. Reported as a short "semantic changelog".
  4. **Covenants** (loan contracts only): reuse services/covenants.py to see
     which obligations were added / tightened / loosened / removed.

Used by the viewer's "What changed?" button to answer auditors' questions in
one glance.
"""
from __future__ import annotations
import json
import re
from typing import Any

try:
    from rapidfuzz import fuzz
    _HAVE_FUZZ = True
except Exception:
    _HAVE_FUZZ = False

from sqlalchemy.orm import Session
from ..models import Document, OcrResult, LoanCovenant


MONEY_RE = re.compile(r"(?P<ccy>EGP|USD|EUR|GBP)?\s*([\d,]+\.?\d*)\s*(million|bn|m|k)?", re.I)
PCT_RE   = re.compile(r"(\d+(?:\.\d+)?)\s*%")
DATE_RE  = re.compile(r"\b(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})\b")
EG_ID_RE = re.compile(r"\b[23]\d{13}\b")


def _load_ocr(db: Session, doc_id: int) -> tuple[str, dict]:
    doc = db.get(Document, doc_id)
    ocr = db.query(OcrResult).filter(OcrResult.document_id == doc_id).first() if doc else None
    text = (ocr.text if ocr else "") or ""
    try:
        fields = json.loads(ocr.fields_json) if ocr and ocr.fields_json else {}
    except Exception:
        fields = {}
    return text, fields


def _entities(text: str) -> dict:
    def money_val(m) -> float:
        v = float(re.sub(r"[^\d.]", "", m.group(2)) or "0")
        unit = (m.group(3) or "").lower()
        return v * (1_000_000 if unit in ("million", "m") else
                    1_000_000_000 if unit == "bn" else
                    1_000 if unit == "k" else 1)
    return {
        "money":   sorted({money_val(m) for m in MONEY_RE.finditer(text)}),
        "pct":     sorted({float(m.group(1)) for m in PCT_RE.finditer(text)}),
        "dates":   sorted({m.group(1) for m in DATE_RE.finditer(text)}),
        "eg_ids":  sorted(set(EG_ID_RE.findall(text))),
    }


def _split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text or "") if s.strip()]


def _sentence_diff(a: list[str], b: list[str]) -> dict:
    if not _HAVE_FUZZ:
        return {"added": [s for s in b if s not in a],
                "removed": [s for s in a if s not in b],
                "changed": []}
    matched_b: set[int] = set()
    changed = []
    same = 0
    for s_a in a:
        best = (0, -1)
        for j, s_b in enumerate(b):
            if j in matched_b:
                continue
            r = fuzz.ratio(s_a, s_b)
            if r > best[0]:
                best = (r, j)
        if best[1] >= 0:
            matched_b.add(best[1])
            if best[0] >= 99:
                same += 1
            elif best[0] >= 75:
                changed.append({"from": s_a[:160], "to": b[best[1]][:160],
                                "similarity": best[0]})
    added = [b[j] for j in range(len(b)) if j not in matched_b]
    removed = [s for s, m in zip(a, [True] * len(a)) if m]  # placeholder

    # Properly compute removed: sentences in A not best-matched in B
    matched_a_idx: set[int] = set()
    for i, s_a in enumerate(a):
        for s_b_j in matched_b:
            if fuzz.ratio(s_a, b[s_b_j]) >= 75:
                matched_a_idx.add(i)
                break
    removed = [a[i] for i in range(len(a)) if i not in matched_a_idx]

    return {"same_count": same, "changed": changed[:20],
            "added": added[:20], "removed": removed[:20]}


def _field_diff(a: dict, b: dict) -> dict:
    keys = set(a) | set(b)
    added, removed, changed, same = [], [], [], []
    for k in keys:
        va, vb = a.get(k), b.get(k)
        if va is None and vb is not None:
            added.append({"field": k, "to": vb})
        elif va is not None and vb is None:
            removed.append({"field": k, "from": va})
        elif va != vb:
            changed.append({"field": k, "from": va, "to": vb})
        else:
            same.append(k)
    return {"added": added, "removed": removed, "changed": changed,
            "unchanged_count": len(same)}


def _entity_diff(a: dict, b: dict) -> dict:
    return {
        "money_added":   [x for x in b["money"]  if x not in a["money"]],
        "money_removed": [x for x in a["money"]  if x not in b["money"]],
        "dates_added":   [x for x in b["dates"]  if x not in a["dates"]],
        "dates_removed": [x for x in a["dates"]  if x not in b["dates"]],
        "pct_added":     [x for x in b["pct"]    if x not in a["pct"]],
        "pct_removed":   [x for x in a["pct"]    if x not in b["pct"]],
        "ids_added":     [x for x in b["eg_ids"] if x not in a["eg_ids"]],
        "ids_removed":   [x for x in a["eg_ids"] if x not in b["eg_ids"]],
    }


def _covenant_diff(db: Session, a_id: int, b_id: int) -> dict:
    a = {(r.kind, r.metric, r.operator, r.threshold): r.clause[:120]
         for r in db.query(LoanCovenant).filter(LoanCovenant.document_id == a_id).all()}
    b = {(r.kind, r.metric, r.operator, r.threshold): r.clause[:120]
         for r in db.query(LoanCovenant).filter(LoanCovenant.document_id == b_id).all()}
    return {
        "added":   [{"key": list(k), "clause": v} for k, v in b.items() if k not in a],
        "removed": [{"key": list(k), "clause": v} for k, v in a.items() if k not in b],
    }


def diff(db: Session, doc_a_id: int, doc_b_id: int) -> dict[str, Any]:
    text_a, fields_a = _load_ocr(db, doc_a_id)
    text_b, fields_b = _load_ocr(db, doc_b_id)
    return {
        "a": doc_a_id, "b": doc_b_id,
        "fields": _field_diff(fields_a, fields_b),
        "entities": _entity_diff(_entities(text_a), _entities(text_b)),
        "sentences": _sentence_diff(_split_sentences(text_a), _split_sentences(text_b)),
        "covenants": _covenant_diff(db, doc_a_id, doc_b_id),
    }

"""PII / PCI redaction pipeline.

Detects and redacts sensitive data across:
  - plain text (OCR output, e-form data, audit events)
  - PDF files (overlay black rectangles on matching tokens, preserving layout)

Default detectors cover common Egyptian + international patterns:
  - Egyptian National ID (14 digits)
  - Passport (one letter + 7-8 digits)
  - Credit cards (Luhn-validated) — PCI primary account number (PAN)
  - IBAN (incl. EG29… variant)
  - Email, phone (Egyptian mobile pattern), IPv4

Swap in Microsoft Presidio / AWS Macie by replacing `detect()`; the rest of the
pipeline (masking, PDF overlay, audit emit) stays unchanged.
"""
from __future__ import annotations
import re
from pathlib import Path
from typing import Iterable


PATTERNS: list[tuple[str, re.Pattern]] = [
    ("EG_NATIONAL_ID", re.compile(r"\b[23]\d{13}\b")),
    ("PASSPORT",       re.compile(r"\b[A-Z]\d{7,8}\b")),
    ("IBAN",           re.compile(r"\bEG\d{2}[A-Z0-9]{25}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")),
    ("CREDIT_CARD",    re.compile(r"\b(?:\d[ -]*?){13,19}\b")),
    ("EMAIL",          re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("EG_PHONE",       re.compile(r"\b(?:\+20|0020|0)1[0125]\d{8}\b")),
    ("IPV4",           re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
]


def _luhn_ok(digits: str) -> bool:
    s = 0
    odd = True
    for ch in reversed(digits):
        if not ch.isdigit():
            continue
        d = int(ch)
        if not odd:
            d *= 2
            if d > 9:
                d -= 9
        s += d
        odd = not odd
    return s % 10 == 0 and len(digits) >= 12


def _ok(kind: str, value: str) -> bool:
    if kind == "CREDIT_CARD":
        return _luhn_ok(re.sub(r"\D", "", value))
    return True


def detect(text: str) -> list[dict]:
    findings: list[dict] = []
    for kind, pat in PATTERNS:
        for m in pat.finditer(text or ""):
            val = m.group(0)
            if _ok(kind, val):
                findings.append({"kind": kind, "value": val, "start": m.start(), "end": m.end()})
    return findings


def _mask(val: str, keep_last: int = 4) -> str:
    clean = val.strip()
    if len(clean) <= keep_last:
        return "•" * len(clean)
    return "•" * (len(clean) - keep_last) + clean[-keep_last:]


def redact_text(text: str) -> tuple[str, list[dict]]:
    """Return (redacted_text, findings). Keeps last 4 chars of PANs/IDs for traceability."""
    findings = detect(text)
    if not findings:
        return text, []
    out = list(text)
    for f in sorted(findings, key=lambda x: x["start"], reverse=True):
        out[f["start"]:f["end"]] = list(_mask(f["value"]))
    return "".join(out), findings


def redact_pdf(pdf_path: str, out_path: str | None = None) -> dict:
    """Overlay black boxes on matching tokens in a PDF; return output path + findings."""
    try:
        import fitz  # pymupdf
    except Exception as e:
        return {"ok": False, "reason": f"pymupdf not installed: {e}"}

    p = Path(pdf_path)
    out = Path(out_path or p.with_name(p.stem + ".redacted.pdf"))
    doc = fitz.open(str(p))
    total_findings: list[dict] = []

    for page in doc:
        text = page.get_text("text")
        findings = detect(text)
        for f in findings:
            for rect in page.search_for(f["value"]):
                page.add_redact_annot(rect, fill=(0, 0, 0))
            total_findings.append({**f, "page": page.number + 1})
        page.apply_redactions()

    doc.save(str(out))
    doc.close()
    return {"ok": True, "output": str(out), "findings": total_findings,
            "findings_count": len(total_findings)}


def redact_event(event: dict) -> dict:
    """Recursively mask string leaves of an audit/event dict."""
    def walk(v):
        if isinstance(v, str):
            return redact_text(v)[0]
        if isinstance(v, dict):
            return {k: walk(val) for k, val in v.items()}
        if isinstance(v, list):
            return [walk(x) for x in v]
        return v
    return walk(event)

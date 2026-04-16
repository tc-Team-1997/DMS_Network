"""Natural-language → structured retention/legal-hold rule compiler.

Examples the compiler understands:

  "Archive passports after 5 years"
  "Purge temp/draft documents after 90 days"
  "After 10 years move trade confirms to cold storage"
  "Place legal hold on documents tagged litigation-2024"
  "Keep audit logs for 7 years per CBE"

Output matches the shape already accepted by services/retention.py:

    {"doc_type": "passport", "retention_days": 1825, "action": "archive_cold"}

So the NL layer is a thin, auditable translator — no new data model.
"""
from __future__ import annotations
import json
import os
import re
from typing import Any


TIME_UNITS = {
    "day": 1, "days": 1,
    "week": 7, "weeks": 7,
    "month": 30, "months": 30,
    "year": 365, "years": 365,
}

DOC_ALIASES = {
    "passport": "passport", "passports": "passport",
    "national id": "national_id", "national ids": "national_id",
    "id card": "national_id", "id cards": "national_id",
    "utility bill": "utility_bill", "utility bills": "utility_bill",
    "loan": "loan_application", "loans": "loan_application",
    "loan agreement": "loan_agreement",
    "contract": "contract", "contracts": "contract",
    "audit log": "audit_log", "audit logs": "audit_log",
    "trade confirm": "trade_confirm", "trade confirms": "trade_confirm",
    "temp": "temp", "draft": "temp", "drafts": "temp",
}

ACTION_ALIASES = {
    "purge": "purge", "delete": "purge", "destroy": "purge",
    "archive": "archive_cold", "cold storage": "archive_cold",
    "move to cold": "archive_cold", "move to glacier": "archive_cold",
    "keep": "archive_cold", "retain": "archive_cold",
}


NUM_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(day|days|week|weeks|month|months|year|years)", re.I)


def _parse_duration(text: str) -> int | None:
    m = NUM_RE.search(text)
    if not m:
        return None
    n = float(m.group(1).replace(",", "."))
    unit = m.group(2).lower()
    return int(round(n * TIME_UNITS[unit]))


def _doc_type(text: str) -> str | None:
    t = text.lower()
    for alias, canonical in sorted(DOC_ALIASES.items(), key=lambda x: -len(x[0])):
        if alias in t:
            return canonical
    return None


def _action(text: str) -> str:
    t = text.lower()
    for alias, canonical in ACTION_ALIASES.items():
        if alias in t:
            return canonical
    if "after" in t:
        return "archive_cold"
    return "purge"


def _is_legal_hold(text: str) -> bool:
    return "legal hold" in text.lower() or "place hold" in text.lower()


def compile_rule(text: str) -> dict[str, Any]:
    text = text.strip()
    if _is_legal_hold(text):
        # Extract a case ref ("litigation-2024", "case #INC-1234")
        m = re.search(r"(?:tagged|case\s*#?)\s*([A-Za-z0-9\-_]+)", text)
        return {
            "kind": "legal_hold",
            "case_ref": (m.group(1) if m else "manual-hold")[:64],
            "reason": text[:200],
        }
    days = _parse_duration(text)
    doc = _doc_type(text)
    action = _action(text)
    errors = []
    if not days:
        errors.append("no duration found (say e.g. '5 years', '30 days')")
    if not doc:
        errors.append("no document type recognized")

    result = {
        "kind": "retention_policy",
        "doc_type": doc,
        "retention_days": days,
        "action": action,
        "source_text": text,
    }
    if errors:
        result["errors"] = errors
        result["valid"] = False
    else:
        result["valid"] = True
        result["summary"] = f"{action} {doc} after {days} days"
    result = _llm_refine(text, result)
    return result


def _llm_refine(text: str, parsed: dict) -> dict:
    if parsed.get("valid"):
        return parsed
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")):
        return parsed
    ask = (
        "Convert the following English retention rule into strict JSON with "
        "keys `doc_type` (string), `retention_days` (int), `action` "
        "('purge' or 'archive_cold'). If the rule mentions a legal hold, "
        "instead output `kind: legal_hold` with `case_ref` + `reason`. "
        "Reply with JSON only.\n"
        f"Rule: {text}"
    )
    try:
        if os.environ.get("ANTHROPIC_API_KEY"):
            from anthropic import Anthropic
            c = Anthropic()
            m = c.messages.create(
                model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
                max_tokens=300,
                messages=[{"role": "user", "content": ask}])
            raw = m.content[0].text if m.content else "{}"
        else:
            from openai import OpenAI
            c = OpenAI()
            r = c.chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": ask}], max_tokens=300)
            raw = r.choices[0].message.content
        m = re.search(r"\{.*\}", raw or "", re.S)
        if not m:
            return parsed
        refined = json.loads(m.group(0))
        refined["source_text"] = text
        refined["valid"] = True
        return refined
    except Exception:
        return parsed

"""Natural-language → workflow JSON compiler.

A checker types:
    "New workflow for KYC with dual sign-off, fraud scoring, and anchor before archive"

…and the designer emits a `WorkflowDesign` spec:

    {
      "name": "KYC Dual Sign-off",
      "steps": [
        {"stage": "capture",   "role": "maker"},
        {"stage": "ai_index",  "role": "system", "gates": ["ocr"]},
        {"stage": "fraud",     "role": "system", "gates": ["fraud_lt_high"]},
        {"stage": "maker",     "role": "maker",  "action": "approve"},
        {"stage": "checker1",  "role": "checker","action": "approve"},
        {"stage": "checker2",  "role": "checker","action": "approve"},
        {"stage": "sign",      "role": "checker","action": "sign"},
        {"stage": "anchor",    "role": "system"},
        {"stage": "archive",   "role": "system"}
      ]
    }

Two compilers:
  - **Deterministic rules** (default): keyword patterns → canonical steps.
    Always available, auditor-friendly, <1 ms.
  - **LLM refinement**: if ANTHROPIC_API_KEY or OPENAI_API_KEY is set, the rule
    output is passed to the model to clean up / add missing stages. The LLM
    output is validated against a JSON Schema before we trust it.
"""
from __future__ import annotations
import json
import os
import re
from typing import Any

from sqlalchemy.orm import Session

from ..models import WorkflowDesign


CANONICAL_STAGES = [
    "capture", "ai_index", "moderation", "fraud",
    "maker", "checker1", "checker2",
    "sign", "anchor", "archive",
]

ROLE_HINTS = {
    "capture": "maker", "ai_index": "system", "moderation": "system",
    "fraud": "system", "maker": "maker",
    "checker1": "checker", "checker2": "checker",
    "sign": "checker", "anchor": "system", "archive": "system",
}


def _detect(prompt: str) -> dict[str, Any]:
    p = prompt.lower()
    want_dual   = any(w in p for w in ("dual", "two checker", "two-checker", "second approval"))
    want_sign   = any(w in p for w in ("sign", "signature", "pades"))
    want_anchor = any(w in p for w in ("anchor", "blockchain", "immutable"))
    want_fraud  = any(w in p for w in ("fraud", "risk score", "risk scoring"))
    want_mod    = any(w in p for w in ("moderation", "content check", "illegal content"))
    want_aml    = any(w in p for w in ("aml", "watchlist", "sanctions"))
    want_stepup = any(w in p for w in ("step-up", "stepup", "webauthn", "mfa"))
    is_kyc      = any(w in p for w in ("kyc", "id", "passport", "national id"))
    is_loan     = any(w in p for w in ("loan", "credit", "mortgage"))

    return {
        "name": (("KYC " if is_kyc else "Loan " if is_loan else "")
                 + ("Dual-signoff " if want_dual else "")
                 + "workflow").strip().title(),
        "dual": want_dual,
        "sign": want_sign,
        "anchor": want_anchor,
        "fraud": want_fraud,
        "moderation": want_mod,
        "aml": want_aml,
        "stepup": want_stepup,
    }


def _build_steps(d: dict[str, Any]) -> list[dict]:
    steps: list[dict] = [{"stage": "capture", "role": "maker"}]
    steps.append({"stage": "ai_index", "role": "system", "gates": ["ocr"]})
    if d["moderation"]:
        steps.append({"stage": "moderation", "role": "system", "gates": ["not_blocked"]})
    if d["fraud"]:
        steps.append({"stage": "fraud", "role": "system", "gates": ["fraud_lt_high_or_stepup"]})
    if d["aml"]:
        steps.append({"stage": "aml", "role": "system", "gates": ["no_open_match"]})
    steps.append({"stage": "maker", "role": "maker", "action": "approve"})
    steps.append({"stage": "checker1", "role": "checker", "action": "approve",
                  "requires_stepup": d["stepup"]})
    if d["dual"]:
        steps.append({"stage": "checker2", "role": "checker", "action": "approve",
                      "must_differ_from": "checker1"})
    if d["sign"]:
        steps.append({"stage": "sign", "role": "checker", "action": "sign"})
    if d["anchor"]:
        steps.append({"stage": "anchor", "role": "system"})
    steps.append({"stage": "archive", "role": "system"})
    return steps


def compile_prompt(prompt: str) -> dict[str, Any]:
    d = _detect(prompt)
    spec = {
        "name": d["name"] or "Custom workflow",
        "description": prompt.strip(),
        "steps": _build_steps(d),
    }
    spec = _llm_refine(prompt, spec)
    errs = _validate(spec)
    return {"spec": spec, "valid": not errs, "errors": errs,
            "inferred": d}


def _validate(spec: dict) -> list[str]:
    errs: list[str] = []
    if not spec.get("name"):
        errs.append("missing name")
    steps = spec.get("steps") or []
    if len(steps) < 3:
        errs.append("need at least capture → review → archive")
    stages = [s.get("stage") for s in steps]
    if stages[0] != "capture":
        errs.append("first stage must be 'capture'")
    if stages[-1] != "archive":
        errs.append("last stage must be 'archive'")
    for s in steps:
        if s.get("stage") not in CANONICAL_STAGES + ["aml"]:
            errs.append(f"unknown stage: {s.get('stage')}")
        if "role" not in s:
            errs.append(f"stage {s.get('stage')} missing role")
    return errs


def _llm_refine(prompt: str, spec: dict) -> dict:
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")):
        return spec
    ask = (
        "You are a workflow compiler. Improve this DMS workflow spec to better match the user's ask. "
        "Output ONLY valid JSON matching the same schema. Keep unknown fields out. "
        f"User ask: {prompt}\n"
        f"Draft spec: {json.dumps(spec)}"
    )
    try:
        if os.environ.get("ANTHROPIC_API_KEY"):
            from anthropic import Anthropic
            c = Anthropic()
            m = c.messages.create(
                model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
                max_tokens=1200,
                messages=[{"role": "user", "content": ask}])
            raw = m.content[0].text if m.content else "{}"
        else:
            from openai import OpenAI
            c = OpenAI()
            r = c.chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": ask}],
                max_tokens=1200)
            raw = r.choices[0].message.content
        refined = json.loads(re.search(r"\{.*\}", raw or "", re.S).group(0))
        if not _validate(refined):
            return refined
    except Exception:
        pass
    return spec


def save(db: Session, tenant: str, name: str, description: str,
         spec: dict, created_by: str) -> int:
    row = WorkflowDesign(tenant=tenant, name=name[:128],
                         description=description[:2000],
                         spec_json=json.dumps(spec),
                         created_by=created_by)
    db.add(row); db.commit(); db.refresh(row)
    return row.id


def list_designs(db: Session, tenant: str) -> list[dict]:
    rows = db.query(WorkflowDesign).filter(WorkflowDesign.tenant == tenant).all()
    return [{"id": r.id, "name": r.name, "description": r.description,
             "spec": json.loads(r.spec_json or "{}"),
             "created_by": r.created_by,
             "created_at": r.created_at.isoformat() if r.created_at else None}
            for r in rows]

"""Compliance coach — explains why a document / customer would be rejected
and what the user needs to do to get it approved.

Composed of purely-interpretable rules (auditor-friendly) plus an optional
LLM paraphrase that converts the finding list into plain language for the
approver. Think of it as "failing test output for compliance".
"""
from __future__ import annotations
import json
import os
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..models import Document, OcrResult, LegalHold, EFormSubmission
from .fraud import score as fraud_score
from .adversarial import detect as adv_detect


def _check_expiry(doc: Document) -> dict | None:
    if not doc.expiry_date:
        if doc.doc_type in ("passport", "national_id"):
            return {"rule": "missing_expiry", "severity": "block",
                    "message": "KYC document must carry an expiry date.",
                    "fix": "Re-scan and capture the expiry field during indexing."}
        return None
    today = datetime.utcnow().date().isoformat()
    if doc.expiry_date < today:
        return {"rule": "expired", "severity": "block",
                "message": f"Document expired on {doc.expiry_date}.",
                "fix": "Ask customer for a renewed copy before approval."}
    return None


def _check_ocr(doc: Document, ocr: OcrResult | None) -> list[dict]:
    out: list[dict] = []
    if ocr is None:
        out.append({"rule": "no_ocr", "severity": "advisory",
                    "message": "OCR has not run yet.",
                    "fix": "Enqueue `ocr.process` task and re-open this review."})
        return out
    if (ocr.confidence or 0) < 0.85:
        out.append({"rule": "low_ocr_confidence", "severity": "warn",
                    "message": f"OCR confidence is {ocr.confidence:.2f} (threshold 0.85).",
                    "fix": "Re-scan at higher DPI or rerun with Arabic model."})
    try:
        fields = json.loads(ocr.fields_json or "{}")
    except Exception:
        fields = {}
    if doc.doc_type == "passport" and not fields.get("passport_no") and not fields.get("mrz"):
        out.append({"rule": "missing_passport_no", "severity": "block",
                    "message": "Passport number not extracted.",
                    "fix": "Ensure the MRZ is fully visible when re-scanning."})
    return out


def _check_holds(db: Session, doc: Document) -> dict | None:
    h = (db.query(LegalHold)
         .filter(LegalHold.document_id == doc.id,
                 LegalHold.released_at == None)  # noqa: E711
         .first())
    if h:
        return {"rule": "legal_hold", "severity": "block",
                "message": f"Active legal hold (case {h.case_ref}) placed by {h.placed_by}.",
                "fix": "Cannot approve while hold is active. Escalate to legal."}
    return None


def _check_risk(db: Session, doc: Document) -> list[dict]:
    out: list[dict] = []
    fr = fraud_score(db, doc)
    if fr["band"] in ("high", "critical"):
        top = ", ".join(s["name"] for s in fr["signals"][:3])
        out.append({"rule": "fraud_risk", "severity": "block" if fr["band"] == "critical" else "warn",
                    "message": f"Fraud band {fr['band']} (score {fr['score']}) — signals: {top}.",
                    "fix": "Require WebAuthn step-up and a second checker before approval."})
    adv = adv_detect(doc.filename)
    if adv.get("band") in ("high", "critical"):
        out.append({"rule": "tampering_suspected", "severity": "block",
                    "message": f"Adversarial signals: {', '.join(s['name'] for s in adv['signals'])}.",
                    "fix": "Re-capture from the physical original; do not trust this file."})
    return out


def _check_missing_docs(db: Session, doc: Document) -> list[dict]:
    # If customer has fewer than the required KYC set, flag the gap.
    if not doc.customer_cid:
        return []
    have = {d.doc_type for d in db.query(Document).filter(
        Document.customer_cid == doc.customer_cid).all() if d.doc_type}
    needed = {"passport", "utility_bill"}
    missing = needed - have
    if missing:
        return [{"rule": "incomplete_kyc_pack", "severity": "warn",
                 "message": f"Customer is missing: {', '.join(sorted(missing))}.",
                 "fix": "Capture the missing documents via the portal or branch."}]
    return []


def _check_eform_consistency(db: Session, doc: Document) -> list[dict]:
    if not doc.customer_cid:
        return []
    forms = db.query(EFormSubmission).filter(
        EFormSubmission.customer_cid == doc.customer_cid).all()
    out: list[dict] = []
    for s in forms:
        data = json.loads(s.data_json or "{}")
        # Example cross-check: DOB on national ID must match e-form DOB.
        if doc.doc_type == "national_id":
            ocr = db.query(OcrResult).filter(OcrResult.document_id == doc.id).first()
            if ocr:
                ocr_fields = json.loads(ocr.fields_json or "{}")
                if ocr_fields.get("dob") and data.get("dob") and ocr_fields["dob"] != data["dob"]:
                    out.append({"rule": "dob_mismatch", "severity": "block",
                                "message": f"DOB on ID ({ocr_fields['dob']}) ≠ e-form DOB ({data['dob']}).",
                                "fix": "Resolve the discrepancy before approval — contact customer."})
    return out


def coach(db: Session, document_id: int) -> dict[str, Any]:
    doc = db.get(Document, document_id)
    if not doc:
        return {"error": "not_found"}
    ocr = db.query(OcrResult).filter(OcrResult.document_id == document_id).first()

    findings: list[dict] = []
    for fn in (_check_expiry, _check_holds):
        r = fn(doc) if fn is _check_expiry else fn(db, doc)
        if r:
            findings.append(r)
    findings.extend(_check_ocr(doc, ocr))
    findings.extend(_check_risk(db, doc))
    findings.extend(_check_missing_docs(db, doc))
    findings.extend(_check_eform_consistency(db, doc))

    blockers = [f for f in findings if f["severity"] == "block"]
    warnings = [f for f in findings if f["severity"] == "warn"]
    advisories = [f for f in findings if f["severity"] == "advisory"]

    approvable = len(blockers) == 0
    summary = _explain(doc, approvable, blockers, warnings, advisories)
    return {
        "document_id": doc.id,
        "approvable": approvable,
        "blockers": blockers,
        "warnings": warnings,
        "advisories": advisories,
        "summary": summary,
    }


def _explain(doc: Document, approvable: bool,
             blockers: list[dict], warnings: list[dict], advisories: list[dict]) -> str:
    """Plain-language summary. Uses Claude / OpenAI if configured, else templated."""
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY"):
        prompt = (
            "You are a KYC compliance coach at National Bank of Egypt. A checker is "
            "reviewing this document. In 2-3 sentences, tell them whether they can "
            "approve and what to do next. Cite rule ids in brackets.\n\n"
            f"Document: #{doc.id} {doc.doc_type or ''} for {doc.customer_cid or '-'}\n"
            f"Blockers: {json.dumps(blockers)}\nWarnings: {json.dumps(warnings)}\n"
            f"Advisories: {json.dumps(advisories)}\n"
        )
        try:
            if os.environ.get("ANTHROPIC_API_KEY"):
                from anthropic import Anthropic
                c = Anthropic()
                m = c.messages.create(model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
                                      max_tokens=250,
                                      messages=[{"role": "user", "content": prompt}])
                if m.content:
                    return m.content[0].text
            from openai import OpenAI
            c = OpenAI()
            r = c.chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": prompt}], max_tokens=250)
            return r.choices[0].message.content
        except Exception:
            pass

    if approvable and not warnings:
        return f"Document #{doc.id} is approvable — no issues found."
    if approvable:
        bullets = " · ".join(w["rule"] for w in warnings)
        return (f"Document #{doc.id} can be approved, but note: {bullets}. "
                "Resolve before sign-off when possible.")
    bullets = " · ".join(b["rule"] for b in blockers)
    fixes = " / ".join(b["fix"] for b in blockers)
    return (f"Document #{doc.id} is NOT approvable. Blocking rules: {bullets}. "
            f"Action plan: {fixes}")

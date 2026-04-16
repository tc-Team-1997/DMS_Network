"""Blast-radius calculator.

"If this document is compromised / voided / withdrawn, what downstream impact?"

Traverses:
  - same-customer documents (KYC chain)
  - workflow steps (who approved it → which tickets / actions were triggered)
  - loan covenants tied to this doc
  - e-form submissions that reference the document_id
  - legal holds + retention policies
  - duplicate matches (so every look-alike is accounted for)
  - AML / watchlist matches
  - signatures + anchor entries (re-issue needed?)

Returns a structured impact report + a 0..100 severity score + recommended
remediation playbook references.
"""
from __future__ import annotations
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import (
    Document, WorkflowStep, LoanCovenant, EFormSubmission, LegalHold,
    DuplicateMatch, WatchlistMatch, ProvenanceEvent,
)


def _weight(kind: str, n: int) -> int:
    w = {
        "cid_chain": 2, "workflow": 3, "covenants": 6, "forms": 2,
        "holds": 15, "duplicates": 5, "watchlist": 12,
        "signatures": 8, "anchors": 6,
    }
    return min(40, w.get(kind, 1) * n)


def compute(db: Session, document_id: int) -> dict[str, Any]:
    doc = db.get(Document, document_id)
    if not doc:
        return {"error": "not_found"}

    # Peer KYC chain for same customer.
    same_cid: list[dict] = []
    if doc.customer_cid:
        for d in db.query(Document).filter(
                Document.customer_cid == doc.customer_cid,
                Document.id != document_id).limit(25).all():
            same_cid.append({"id": d.id, "doc_type": d.doc_type,
                             "status": d.status, "expiry_date": d.expiry_date})

    workflow = [{
        "id": s.id, "stage": s.stage, "action": s.action, "actor": s.actor,
        "at": s.created_at.isoformat() if s.created_at else None,
    } for s in db.query(WorkflowStep).filter(
        WorkflowStep.document_id == document_id).all()]

    covenants = [{"id": c.id, "kind": c.kind, "metric": c.metric,
                  "operator": c.operator, "threshold": c.threshold}
                 for c in db.query(LoanCovenant).filter(
        LoanCovenant.document_id == document_id).all()]

    forms = [{"id": s.id, "form_id": s.form_id,
              "created_at": s.created_at.isoformat() if s.created_at else None}
             for s in db.query(EFormSubmission).filter(
        EFormSubmission.document_id == document_id).all()]

    holds = [{"id": h.id, "case_ref": h.case_ref, "placed_by": h.placed_by,
              "released_at": h.released_at.isoformat() if h.released_at else None}
             for h in db.query(LegalHold).filter(
        LegalHold.document_id == document_id).all()]

    dups = [{"match_id": m.id, "other": m.doc_b if m.doc_a == document_id else m.doc_a,
             "similarity": m.similarity, "type": m.match_type}
            for m in db.query(DuplicateMatch).filter(
        or_(DuplicateMatch.doc_a == document_id,
            DuplicateMatch.doc_b == document_id)).all()]

    watch = [{"id": w.id, "matched_name": w.matched_name, "status": w.status}
             for w in db.query(WatchlistMatch).filter(
        WatchlistMatch.document_id == document_id).all()]

    signed_steps = [s for s in workflow if s["stage"] == "sign" or s["action"] in ("signed", "pades_signed")]
    anchor_events = [e.id for e in db.query(ProvenanceEvent).filter(
        ProvenanceEvent.document_id == document_id,
        ProvenanceEvent.kind == "anchored").all()]

    score = sum([
        _weight("cid_chain", len(same_cid)),
        _weight("workflow", len(workflow)),
        _weight("covenants", len(covenants)),
        _weight("forms", len(forms)),
        _weight("holds", len(holds)),
        _weight("duplicates", len(dups)),
        _weight("watchlist", len(watch)),
        _weight("signatures", len(signed_steps)),
        _weight("anchors", len(anchor_events)),
    ])
    score = min(100, score)
    band = "low" if score < 30 else "medium" if score < 60 \
           else "high" if score < 85 else "critical"

    playbook = []
    if signed_steps:
        playbook.append("Re-issue PAdES signatures on dependent downstream docs")
    if anchor_events:
        playbook.append("Publish revocation to transparency log (services/transparency)")
    if holds:
        playbook.append("Notify legal — active hold may block destruction")
    if covenants:
        playbook.append("Credit team: recheck loan covenants — dependent facility may trigger EoD")
    if watch:
        playbook.append("AML team: re-run watchlist scan on peer documents")
    if len(same_cid) > 3:
        playbook.append(f"KYC team: refresh full KYC pack for {doc.customer_cid}")

    return {
        "document_id": doc.id,
        "customer_cid": doc.customer_cid,
        "doc_type": doc.doc_type,
        "score": score, "band": band,
        "dependencies": {
            "same_cid_documents": same_cid,
            "workflow_steps": workflow,
            "covenants": covenants,
            "eform_submissions": forms,
            "legal_holds": holds,
            "duplicates": dups,
            "watchlist_matches": watch,
            "signed_steps": signed_steps,
            "anchor_events": anchor_events,
        },
        "counts": {
            "peers": len(same_cid), "workflow_steps": len(workflow),
            "covenants": len(covenants), "forms": len(forms),
            "holds": len(holds), "duplicates": len(dups),
            "watchlist": len(watch), "signatures": len(signed_steps),
            "anchors": len(anchor_events),
        },
        "playbook": playbook,
    }

"""Per-customer risk aggregation.

Aggregates the per-document fraud score into a single customer view:
  - max_score, avg_score, score counts per band
  - expired / expiring document counts
  - AML + IFRS9 signals from the integration_logs table
  - duplicate-count across all customer docs
  - portal submission count (a portal-only customer is a slightly different risk profile)
"""
from __future__ import annotations
from datetime import datetime
from typing import Any
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Document, DuplicateMatch, EFormSubmission, PortalSession, IntegrationLog
from .fraud import score as per_doc_score


def customer_risk(db: Session, customer_cid: str, tenant: str = "default") -> dict[str, Any]:
    docs = db.query(Document).filter(
        Document.customer_cid == customer_cid,
        Document.tenant == tenant,
    ).all()
    if not docs:
        return {"customer_cid": customer_cid, "documents": 0, "band": "unknown"}

    today = datetime.utcnow().date().isoformat()
    per_doc: list[dict] = []
    score_vals: list[int] = []
    counts = {"low": 0, "medium": 0, "high": 0, "critical": 0}

    for d in docs:
        s = per_doc_score(db, d)
        per_doc.append({"document_id": d.id, "score": s["score"], "band": s["band"]})
        score_vals.append(s["score"])
        counts[s["band"]] = counts.get(s["band"], 0) + 1

    expired = sum(1 for d in docs if d.expiry_date and d.expiry_date < today)

    dup_doc_ids = {d.id for d in docs}
    dups = (
        db.query(func.count(DuplicateMatch.id))
        .filter((DuplicateMatch.doc_a.in_(dup_doc_ids)) | (DuplicateMatch.doc_b.in_(dup_doc_ids)))
        .scalar() or 0
    )

    aml_hits = (
        db.query(func.count(IntegrationLog.id))
        .filter(IntegrationLog.system == "aml",
                IntegrationLog.response_json.ilike('%"watchlist_hit": true%'))
        .scalar() or 0
    )

    form_count = db.query(func.count(EFormSubmission.id)).filter(
        EFormSubmission.customer_cid == customer_cid
    ).scalar() or 0
    portal_sessions = db.query(func.count(PortalSession.id)).filter(
        PortalSession.customer_cid == customer_cid
    ).scalar() or 0

    # Customer-level score = max single-doc score, bumped +10 per AML hit and +5 per duplicate.
    peak = max(score_vals) if score_vals else 0
    peak += min(30, aml_hits * 10)
    peak += min(20, dups * 5)
    peak = min(100, peak)
    band = "low" if peak < 30 else "medium" if peak < 60 else "high" if peak < 85 else "critical"

    return {
        "customer_cid": customer_cid,
        "tenant": tenant,
        "documents": len(docs),
        "expired_documents": expired,
        "duplicate_findings": int(dups),
        "aml_watchlist_hits": int(aml_hits),
        "form_submissions": int(form_count),
        "portal_sessions": int(portal_sessions),
        "max_score": max(score_vals) if score_vals else 0,
        "avg_score": round(sum(score_vals) / len(score_vals), 1) if score_vals else 0.0,
        "score": peak,
        "band": band,
        "band_counts": counts,
        "per_document": per_doc,
    }


def portfolio_top_risks(db: Session, tenant: str = "default", limit: int = 20) -> list[dict]:
    cids = [
        r[0] for r in db.query(Document.customer_cid)
        .filter(Document.tenant == tenant, Document.customer_cid != None)  # noqa: E711
        .distinct().all()
    ]
    out = []
    for cid in cids:
        r = customer_risk(db, cid, tenant)
        out.append({"customer_cid": cid, "score": r["score"], "band": r["band"],
                    "documents": r["documents"], "expired_documents": r["expired_documents"]})
    out.sort(key=lambda x: x["score"], reverse=True)
    return out[:limit]

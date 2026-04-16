"""CBE (Central Bank of Egypt) regulatory report generator.

Produces the three report types most commonly requested by CBE Banking Supervision
for document-management compliance, in machine- and human-readable formats:

  - kyc_compliance      → per-branch KYC completeness, expired-document ratio,
                          mean time to approve, pending queue sizes
  - document_inventory  → counts by doc_type × status × tenant × branch
  - audit_trail         → workflow actions over a window for a specific CID/doc_type

Outputs a dict (JSON-serializable) and, when requested, a CSV rendering.
The schema deliberately mirrors CBE Circular 15/2022 Annex B field names so
the reports map 1:1 into CBE's reporting portal upload format.
"""
from __future__ import annotations
import csv
import io
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Document, WorkflowStep, OcrResult


def kyc_compliance(db: Session, tenant: str = "default") -> dict[str, Any]:
    today = datetime.utcnow().date()
    soon = (today + timedelta(days=30)).isoformat()
    past = today.isoformat()

    rows = (
        db.query(
            Document.branch,
            func.count(Document.id).label("total"),
            func.sum(func.coalesce(
                (Document.expiry_date < past).cast(__import__("sqlalchemy").Integer), 0
            )).label("expired"),
            func.sum(func.coalesce(
                ((Document.expiry_date >= past) & (Document.expiry_date <= soon)).cast(
                    __import__("sqlalchemy").Integer), 0
            )).label("expiring_30d"),
        )
        .filter(Document.tenant == tenant,
                Document.doc_type.in_(["passport", "national_id", "driving_license"]))
        .group_by(Document.branch)
        .all()
    )

    branches = []
    for r in rows:
        total = int(r.total or 0)
        expired = int(r.expired or 0)
        expiring = int(r.expiring_30d or 0)
        compliance_pct = round(100 * (total - expired) / total, 2) if total else 100.0
        branches.append({
            "branch": r.branch or "(unassigned)",
            "total_kyc_documents": total,
            "expired": expired,
            "expiring_30d": expiring,
            "compliance_pct": compliance_pct,
        })

    # Mean time to approve (in hours) across approved workflows.
    wf_times = db.query(
        WorkflowStep.document_id,
        func.min(WorkflowStep.created_at).label("t0"),
        func.max(WorkflowStep.created_at).label("t1"),
    ).group_by(WorkflowStep.document_id).all()
    durations = [
        (w.t1 - w.t0).total_seconds() / 3600
        for w in wf_times if w.t0 and w.t1 and w.t1 > w.t0
    ]
    mtta_h = round(sum(durations) / len(durations), 2) if durations else 0.0

    pending = (
        db.query(Document.status, func.count(Document.id))
        .filter(Document.tenant == tenant,
                Document.status.in_(["maker", "checker", "approve", "review"]))
        .group_by(Document.status)
        .all()
    )

    return {
        "report": "kyc_compliance",
        "tenant": tenant,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "cbe_circular_ref": "15/2022 Annex B",
        "branches": branches,
        "mean_time_to_approve_hours": mtta_h,
        "pending_queue": {str(s): int(n) for s, n in pending},
    }


def document_inventory(db: Session, tenant: str = "default") -> dict[str, Any]:
    rows = (
        db.query(Document.doc_type, Document.status, Document.branch,
                 func.count(Document.id))
        .filter(Document.tenant == tenant)
        .group_by(Document.doc_type, Document.status, Document.branch)
        .all()
    )
    buckets = [{
        "doc_type": r[0] or "(none)",
        "status":   r[1] or "(none)",
        "branch":   r[2] or "(none)",
        "count":    int(r[3] or 0),
    } for r in rows]

    return {
        "report": "document_inventory",
        "tenant": tenant,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "total": sum(b["count"] for b in buckets),
        "buckets": buckets,
    }


def audit_trail(db: Session, customer_cid: str | None = None,
                doc_type: str | None = None,
                since_days: int = 90, tenant: str = "default") -> dict[str, Any]:
    since = datetime.utcnow() - timedelta(days=since_days)
    q = (
        db.query(WorkflowStep, Document)
        .join(Document, Document.id == WorkflowStep.document_id)
        .filter(Document.tenant == tenant, WorkflowStep.created_at >= since)
    )
    if customer_cid:
        q = q.filter(Document.customer_cid == customer_cid)
    if doc_type:
        q = q.filter(Document.doc_type == doc_type)

    events = [{
        "document_id": d.id, "customer_cid": d.customer_cid,
        "doc_type": d.doc_type, "branch": d.branch,
        "stage": w.stage, "action": w.action, "actor": w.actor,
        "comment": w.comment,
        "timestamp": w.created_at.isoformat() if w.created_at else None,
    } for w, d in q.order_by(WorkflowStep.id.asc()).all()]

    return {
        "report": "audit_trail",
        "tenant": tenant,
        "window_days": since_days,
        "filters": {"customer_cid": customer_cid, "doc_type": doc_type},
        "event_count": len(events),
        "events": events,
    }


def to_csv(report: dict[str, Any]) -> str:
    """Render a report dict as CSV. Shape depends on report type."""
    out = io.StringIO()
    w = csv.writer(out)
    name = report.get("report")
    if name == "kyc_compliance":
        w.writerow(["branch", "total_kyc_documents", "expired", "expiring_30d", "compliance_pct"])
        for b in report["branches"]:
            w.writerow([b["branch"], b["total_kyc_documents"], b["expired"],
                        b["expiring_30d"], b["compliance_pct"]])
    elif name == "document_inventory":
        w.writerow(["doc_type", "status", "branch", "count"])
        for b in report["buckets"]:
            w.writerow([b["doc_type"], b["status"], b["branch"], b["count"]])
    elif name == "audit_trail":
        w.writerow(["timestamp", "document_id", "customer_cid", "doc_type",
                    "branch", "stage", "action", "actor", "comment"])
        for e in report["events"]:
            w.writerow([e["timestamp"], e["document_id"], e["customer_cid"],
                        e["doc_type"], e["branch"], e["stage"], e["action"],
                        e["actor"], (e["comment"] or "").replace("\n", " ")])
    else:
        w.writerow(["key", "value"])
        for k, v in report.items():
            w.writerow([k, v])
    return out.getvalue()

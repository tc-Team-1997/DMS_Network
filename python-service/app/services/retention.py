"""Retention + legal-hold engine.

Semantics:
  - A RetentionPolicy binds a `doc_type` to `retention_days` + `action`
    (`purge` = hard delete, `archive_cold` = move to cold storage tier / archived status).
  - A LegalHold on a document overrides retention — the document is immune to purge
    until the hold is released.
  - `purge_due()` returns documents eligible for action (retention expired AND not held).
  - `apply_due()` performs the action and records audit trail.

Run `scripts/retention_run.py` on a nightly cron.
"""
from __future__ import annotations
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Document, RetentionPolicy, LegalHold, WorkflowStep
from .events import emit


def has_active_hold(db: Session, document_id: int) -> bool:
    return db.query(LegalHold).filter(
        LegalHold.document_id == document_id,
        LegalHold.released_at == None,  # noqa: E711
    ).first() is not None


def place_hold(db: Session, document_id: int, reason: str, case_ref: str, placed_by: str) -> LegalHold:
    hold = LegalHold(document_id=document_id, reason=reason, case_ref=case_ref, placed_by=placed_by)
    db.add(hold)
    db.add(WorkflowStep(document_id=document_id, stage="legal_hold", actor=placed_by,
                        action="placed", comment=f"{case_ref}: {reason}"))
    db.commit()
    db.refresh(hold)
    emit("legal_hold.placed", document_id=document_id, case_ref=case_ref, placed_by=placed_by)
    return hold


def release_hold(db: Session, hold_id: int, released_by: str) -> LegalHold:
    hold = db.get(LegalHold, hold_id)
    if not hold or hold.released_at is not None:
        raise ValueError("Hold not found or already released")
    hold.released_at = datetime.utcnow()
    hold.released_by = released_by
    db.add(WorkflowStep(document_id=hold.document_id, stage="legal_hold",
                        actor=released_by, action="released"))
    db.commit()
    db.refresh(hold)
    emit("legal_hold.released", document_id=hold.document_id, hold_id=hold_id, released_by=released_by)
    return hold


def upsert_policy(db: Session, doc_type: str, retention_days: int,
                  action: str = "purge", tenant: str = "default") -> RetentionPolicy:
    p = db.query(RetentionPolicy).filter(
        RetentionPolicy.doc_type == doc_type, RetentionPolicy.tenant == tenant
    ).first()
    if p:
        p.retention_days = retention_days
        p.action = action
    else:
        p = RetentionPolicy(doc_type=doc_type, retention_days=retention_days,
                            action=action, tenant=tenant)
        db.add(p)
    db.commit()
    db.refresh(p)
    return p


def purge_due(db: Session, tenant: str | None = None, limit: int = 1000) -> list[dict]:
    """Return docs whose retention has expired and have no active hold."""
    now = datetime.utcnow()
    q = db.query(Document, RetentionPolicy).join(
        RetentionPolicy, RetentionPolicy.doc_type == Document.doc_type
    )
    if tenant:
        q = q.filter(Document.tenant == tenant, RetentionPolicy.tenant == tenant)
    out: list[dict] = []
    for doc, pol in q.limit(limit * 4).all():
        if not doc.created_at:
            continue
        if doc.created_at + timedelta(days=pol.retention_days) > now:
            continue
        if has_active_hold(db, doc.id):
            continue
        out.append({"document": doc, "policy": pol})
        if len(out) >= limit:
            break
    return out


def apply_due(db: Session, dry_run: bool = True, tenant: str | None = None) -> dict[str, Any]:
    """Execute retention actions. Returns a summary. Safe to re-run."""
    due = purge_due(db, tenant=tenant)
    summary = {"examined": len(due), "purged": 0, "archived": 0, "skipped": 0,
               "dry_run": dry_run, "details": []}
    for item in due:
        doc: Document = item["document"]
        pol: RetentionPolicy = item["policy"]
        entry = {"id": doc.id, "doc_type": doc.doc_type, "action": pol.action}
        if dry_run:
            summary["skipped"] += 1
            summary["details"].append({**entry, "result": "dry_run"})
            continue
        try:
            if pol.action == "archive_cold":
                doc.status = "archived"
                db.add(WorkflowStep(document_id=doc.id, stage="retention",
                                    actor="system", action="archived",
                                    comment=f"retention {pol.retention_days}d"))
                summary["archived"] += 1
            else:  # purge
                # Remove files from disk; DB row cascades delete.
                for suffix in ("", ".sig", ".sig.json"):
                    p = Path(doc.filename + suffix) if suffix else Path(doc.filename)
                    try:
                        if p.exists():
                            p.unlink()
                    except Exception:
                        pass
                db.delete(doc)
                summary["purged"] += 1
            emit("retention.applied", document_id=entry["id"], action=pol.action)
            summary["details"].append({**entry, "result": "ok"})
        except Exception as e:
            summary["skipped"] += 1
            summary["details"].append({**entry, "result": "error", "error": str(e)[:200]})

    if not dry_run:
        db.commit()
    return summary

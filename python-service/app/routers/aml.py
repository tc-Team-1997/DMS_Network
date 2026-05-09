"""AML match review router.

Surfaces watchlist match data in the format expected by the Fortune 50 demo
dashboard:
  GET  /aml/matches          — paginated match list with confidence scores
  POST /aml/matches/bulk-review  — clear / escalate a batch of matches
  GET  /aml/stats            — aggregate counts for dashboard widget
"""
from __future__ import annotations

from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import WatchlistMatch, WatchlistEntry, AuditLog
from ..security import require_api_key
from ..services.auth import require, Principal
from ..services.events import emit

router = APIRouter(
    prefix="/api/v1/aml",
    tags=["aml"],
    dependencies=[Depends(require_api_key)],
)


# ─────────────────────────────── schemas ────────────────────────────────────

class BulkReviewIn(BaseModel):
    match_ids: List[int]
    action: str        # "clear" | "escalate"
    notes: Optional[str] = None


# ─────────────────────────────── helpers ────────────────────────────────────

def _match_to_dict(m: WatchlistMatch, entry: Optional[WatchlistEntry]) -> dict:
    return {
        "match_id": m.id,
        "customer_name": m.matched_name or "",
        "watchlist_name": entry.name if entry else m.matched_name or "",
        "score": round(float(m.score or 0), 1),
        "status": m.status,
        "reviewed_by": m.reviewed_by,
        "reviewed_at": m.reviewed_at.isoformat() if m.reviewed_at else None,
        "customer_cid": m.customer_cid,
        "document_id": m.document_id,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


# ─────────────────────────────── endpoints ──────────────────────────────────

@router.get("/matches")
def list_matches(
    status: Optional[str] = "open",
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("audit_read")),
):
    """Return watchlist matches with confidence scores."""
    q = db.query(WatchlistMatch)
    if status:
        q = q.filter(WatchlistMatch.status == status)
    total = q.count()
    rows = q.order_by(WatchlistMatch.id.desc()).offset(offset).limit(limit).all()

    # Batch-load watchlist entries to get full names.
    entry_ids = {r.entry_id for r in rows if r.entry_id}
    entries = (
        {e.id: e for e in db.query(WatchlistEntry).filter(WatchlistEntry.id.in_(entry_ids)).all()}
        if entry_ids
        else {}
    )

    return {
        "total": total,
        "items": [_match_to_dict(r, entries.get(r.entry_id)) for r in rows],
    }


@router.post("/matches/bulk-review")
def bulk_review(
    body: BulkReviewIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("approve")),
):
    """Clear or escalate a batch of AML matches."""
    if body.action not in ("clear", "escalate"):
        raise HTTPException(400, "action must be 'clear' or 'escalate'")

    status_map = {"clear": "cleared", "escalate": "escalated"}
    new_status = status_map[body.action]

    rows = db.query(WatchlistMatch).filter(WatchlistMatch.id.in_(body.match_ids)).all()
    if not rows:
        raise HTTPException(404, "No matching records found")

    now = datetime.utcnow()
    updated_ids: list[int] = []
    for m in rows:
        m.status = new_status
        m.reviewed_by = p.sub
        m.reviewed_at = now
        updated_ids.append(m.id)

        db.add(
            AuditLog(
                tenant=getattr(p, "tenant", "default") or "default",
                actor=p.sub,
                action=f"aml_bulk_{body.action}",
                resource_type="watchlist_match",
                resource_id=str(m.id),
                detail=body.notes or "",
            )
        )

    db.commit()
    emit("aml.bulk_review", match_ids=updated_ids, action=body.action, reviewer=p.sub)

    return {
        "updated": len(updated_ids),
        "match_ids": updated_ids,
        "new_status": new_status,
        "reviewed_by": p.sub,
        "reviewed_at": now.isoformat() + "Z",
    }


@router.get("/stats")
def stats(
    db: Session = Depends(get_db),
    p: Principal = Depends(require("audit_read")),
):
    """Aggregate AML match counts for the dashboard widget."""
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    total_matches = db.query(WatchlistMatch).count()
    pending_review = (
        db.query(WatchlistMatch).filter(WatchlistMatch.status == "open").count()
    )
    cleared_today = (
        db.query(WatchlistMatch)
        .filter(
            WatchlistMatch.status == "cleared",
            WatchlistMatch.reviewed_at >= today_start,
        )
        .count()
    )
    escalated_open = (
        db.query(WatchlistMatch)
        .filter(WatchlistMatch.status == "escalated")
        .count()
    )

    return {
        "total_matches": total_matches,
        "pending_review": pending_review,
        "cleared_today": cleared_today,
        "escalated_open": escalated_open,
    }

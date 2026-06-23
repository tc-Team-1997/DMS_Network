from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import case, select
from sqlalchemy.orm import Session

from zordms_ai.review.models import ReviewItem
from zordms_ai.routing.confidence import RouteDecision


def enqueue(
    session: Session,
    *,
    doc_id: str,
    doc_type: str,
    confidence: float,
    decision: RouteDecision,
    payload_json: str,
    now: datetime,
) -> ReviewItem:
    deadline = now + timedelta(hours=decision.sla_hours) if decision.sla_hours is not None else None
    item = ReviewItem(
        doc_id=doc_id,
        doc_type=doc_type,
        confidence=confidence,
        band=decision.band,
        sla_hours=decision.sla_hours,
        sla_deadline=deadline,
        status="PENDING",
        payload_json=payload_json,
        created_at=now,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def list_pending(session: Session) -> list[ReviewItem]:
    # Use a portable CASE-based secondary sort key instead of NULLS LAST so this
    # compiles correctly on PostgreSQL, Oracle 19c, and SQLite (F-03).
    # NULLs sort after non-NULL deadlines (deadline=NULL means no SLA pressure).
    null_last_key = case(
        (ReviewItem.sla_deadline.is_(None), 1),
        else_=0,
    )
    stmt = (
        select(ReviewItem)
        .where(ReviewItem.status == "PENDING")
        .order_by(null_last_key, ReviewItem.sla_deadline.asc())
    )
    return list(session.scalars(stmt))


def claim(session: Session, item_id: int, user_id: str) -> ReviewItem:
    item = session.get(ReviewItem, item_id)
    if item is None:
        raise ValueError(f"review item {item_id} not found")
    if item.status != "PENDING":
        raise ValueError(f"review item {item_id} is {item.status}, cannot claim")
    item.status = "CLAIMED"
    item.claimed_by = user_id
    session.commit()
    session.refresh(item)
    return item


def resolve(session: Session, item_id: int, resolution: str, now: datetime) -> ReviewItem:
    item = session.get(ReviewItem, item_id)
    if item is None:
        raise ValueError(f"review item {item_id} not found")
    item.status = "RESOLVED"
    item.resolution = resolution
    item.resolved_at = now
    session.commit()
    session.refresh(item)
    return item

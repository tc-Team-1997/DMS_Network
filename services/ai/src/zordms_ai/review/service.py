from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
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
    stmt = (
        select(ReviewItem)
        .where(ReviewItem.status == "PENDING")
        .order_by(ReviewItem.sla_deadline.asc().nulls_last())
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

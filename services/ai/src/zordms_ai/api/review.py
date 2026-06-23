from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Form, HTTPException, Request

from zordms_ai.review.models import ReviewItem
from zordms_ai.review.service import claim, list_pending, resolve

review_router = APIRouter(prefix="/idp/review")


def _dump(item: ReviewItem) -> dict:
    return {
        "id": item.id,
        "doc_id": item.doc_id,
        "doc_type": item.doc_type,
        "confidence": item.confidence,
        "band": item.band,
        "sla_hours": item.sla_hours,
        "sla_deadline": item.sla_deadline.isoformat() if item.sla_deadline else None,
        "status": item.status,
        "claimed_by": item.claimed_by,
        "resolution": item.resolution,
    }


@review_router.get("/pending")
def pending(request: Request) -> list[dict]:
    with request.app.state.session_factory() as session:
        return [_dump(i) for i in list_pending(session)]


@review_router.post("/{item_id}/claim")
def claim_item(request: Request, item_id: int, user_id: str = Form(...)) -> dict:
    with request.app.state.session_factory() as session:
        try:
            item = claim(session, item_id, user_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return _dump(item)


@review_router.post("/{item_id}/resolve")
def resolve_item(request: Request, item_id: int, resolution: str = Form(...)) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with request.app.state.session_factory() as session:
        item = resolve(session, item_id, resolution, now=now)
        return _dump(item)

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.watchlist import sync, rematch, list_matches, review

router = APIRouter(prefix="/api/v1/watchlist", tags=["watchlist"])


class ReviewIn(BaseModel):
    action: str   # cleared | escalated


@router.post("/sync")
def sync_now(db: Session = Depends(get_db),
             p: Principal = Depends(require("admin"))):
    return sync(db)


@router.post("/rematch")
def rematch_now(threshold: int = Query(88, ge=50, le=100),
                db: Session = Depends(get_db),
                p: Principal = Depends(require("admin"))):
    return rematch(db, threshold)


@router.get("/matches")
def matches(status: str | None = "open", limit: int = 100,
            db: Session = Depends(get_db),
            p: Principal = Depends(require("audit_read"))):
    return list_matches(db, status, limit)


@router.post("/matches/{match_id}/review")
def review_match(match_id: int, body: ReviewIn,
                 db: Session = Depends(get_db),
                 p: Principal = Depends(require("approve"))):
    try:
        return review(db, match_id, body.action, p.sub)
    except ValueError as e:
        raise HTTPException(400, str(e))

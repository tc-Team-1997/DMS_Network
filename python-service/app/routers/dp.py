from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.dp import dp_count, dp_sum_bytes, dp_histogram_status, budget_status

router = APIRouter(prefix="/api/v1/dp", tags=["differential-privacy"])


def _check(r: dict):
    if r.get("error") == "budget_exhausted":
        raise HTTPException(429, detail=r)


@router.get("/count")
def count(doc_type: Optional[str] = None, branch: Optional[str] = None,
          epsilon: float = Query(1.0, ge=0.1, le=5.0),
          db: Session = Depends(get_db),
          p: Principal = Depends(require("audit_read"))):
    r = dp_count(db, p.tenant, doc_type=doc_type, branch=branch, epsilon=epsilon)
    _check(r)
    return r


@router.get("/sum-bytes")
def sum_bytes(clip_mb: float = 10.0, epsilon: float = Query(2.0, ge=0.1, le=5.0),
              db: Session = Depends(get_db),
              p: Principal = Depends(require("audit_read"))):
    r = dp_sum_bytes(db, p.tenant, clip_mb=clip_mb, epsilon=epsilon)
    _check(r)
    return r


@router.get("/histogram-status")
def histogram(epsilon: float = Query(2.0, ge=0.1, le=5.0),
              db: Session = Depends(get_db),
              p: Principal = Depends(require("audit_read"))):
    r = dp_histogram_status(db, p.tenant, epsilon=epsilon)
    _check(r)
    return r


@router.get("/budget")
def budget(p: Principal = Depends(require("audit_read"))):
    return {"tenant": p.tenant, "remaining_epsilon": budget_status(p.tenant)}

from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.usage import top_features, adoption_by_role, daily_cohort

router = APIRouter(prefix="/api/v1/usage", tags=["usage-analytics"])


@router.get("/top-features")
def top(days: int = Query(7, ge=1, le=90), limit: int = Query(15, ge=1, le=100),
        db: Session = Depends(get_db), p: Principal = Depends(require("audit_read"))):
    return top_features(db, days, limit)


@router.get("/adoption")
def adoption(feature: str, days: int = Query(30, ge=1, le=365),
             db: Session = Depends(get_db),
             p: Principal = Depends(require("audit_read"))):
    return adoption_by_role(db, feature, days)


@router.get("/cohort")
def cohort(feature: Optional[str] = None, days: int = Query(14, ge=1, le=180),
           db: Session = Depends(get_db),
           p: Principal = Depends(require("audit_read"))):
    return daily_cohort(db, feature, days)

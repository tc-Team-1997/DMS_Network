from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.ifrs9 import portfolio_ecl

router = APIRouter(prefix="/api/v1/ifrs9", tags=["ifrs9"])


@router.get("/ecl")
def ecl(reporting_currency: str = "EGP",
        as_of: Optional[datetime] = None,
        db: Session = Depends(get_db),
        p: Principal = Depends(require("audit_read"))):
    return portfolio_ecl(db, reporting_currency.upper(), as_of, p.tenant)

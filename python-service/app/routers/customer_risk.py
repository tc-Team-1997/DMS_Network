from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.customer_risk import customer_risk, portfolio_top_risks

router = APIRouter(prefix="/api/v1/customers", tags=["customer-risk"])


@router.get("/{customer_cid}/risk")
def risk(customer_cid: str, db: Session = Depends(get_db),
         p: Principal = Depends(require("approve"))):
    return customer_risk(db, customer_cid, p.tenant)


@router.get("/top-risks")
def top(limit: int = 20, db: Session = Depends(get_db),
        p: Principal = Depends(require("approve"))):
    return portfolio_top_risks(db, p.tenant, limit)

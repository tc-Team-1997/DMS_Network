from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services import fx as fxsvc
from ..services.integrations import call_system

router = APIRouter(prefix="/api/v1/fx", tags=["fx"])


class RateIn(BaseModel):
    base: str
    quote: str
    rate: float
    as_of: Optional[datetime] = None
    source: str = "manual"


@router.post("/rates")
def set_rate(body: RateIn, db: Session = Depends(get_db),
             p: Principal = Depends(require("admin"))):
    r = fxsvc.set_rate(db, body.base, body.quote, body.rate, body.as_of, body.source)
    return {"id": r.id, "base": r.base, "quote": r.quote, "rate": r.rate,
            "as_of": r.as_of.isoformat()}


@router.get("/rate")
def get_rate(base: str, quote: str, at: Optional[datetime] = None,
             db: Session = Depends(get_db), p: Principal = Depends(require("view"))):
    r = fxsvc.rate(db, base, quote, at)
    if r is None:
        raise HTTPException(404, f"No rate for {base}->{quote}")
    return {"base": base.upper(), "quote": quote.upper(), "rate": r, "at": at}


@router.get("/convert")
def convert(amount: float, from_ccy: str = Query(..., alias="from"),
            to_ccy: str = Query(..., alias="to"),
            at: Optional[datetime] = None,
            db: Session = Depends(get_db), p: Principal = Depends(require("view"))):
    v = fxsvc.convert(db, amount, from_ccy, to_ccy, at)
    if v is None:
        raise HTTPException(404, f"Cannot convert {from_ccy}->{to_ccy}")
    return {"amount": amount, "from": from_ccy.upper(), "to": to_ccy.upper(),
            "converted": v, "at": at}


@router.post("/refresh-from-cbs")
async def refresh_from_cbs(db: Session = Depends(get_db),
                           p: Principal = Depends(require("admin"))):
    """Pull daily rates from CBS integration — falls back to mocked payload."""
    r = await call_system(db, "cbs", "/fx/rates/daily", "GET", {})
    body = r.get("body", {})
    rates = body.get("rates") or [
        {"base": "USD", "quote": "EGP", "rate": 48.7},
        {"base": "EUR", "quote": "EGP", "rate": 52.5},
        {"base": "GBP", "quote": "EGP", "rate": 62.1},
    ]
    saved = []
    for row in rates:
        saved.append(fxsvc.set_rate(db, row["base"], row["quote"], row["rate"], source="cbs"))
    return {"imported": len(saved)}

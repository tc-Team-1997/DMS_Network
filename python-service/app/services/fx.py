"""FX rate storage + conversion for IFRS 9 normalization.

Strategy:
  - Store rates per (base, quote, as_of). Latest row wins for live conversion.
  - For IFRS 9 reports, pick the rate effective on a specific reporting date:
    the most recent rate at or before that date.
  - All IFRS 9 amounts are normalized to a `reporting_currency` (default EGP)
    so cross-currency loan portfolios aggregate correctly.
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..models import FxRate


REPORTING_CCY_DEFAULT = "EGP"


def set_rate(db: Session, base: str, quote: str, rate: float,
             as_of: datetime | None = None, source: str = "manual") -> FxRate:
    row = FxRate(
        base=base.upper(), quote=quote.upper(), rate=float(rate),
        as_of=as_of or datetime.utcnow(), source=source,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _pick(db: Session, base: str, quote: str, at: datetime | None) -> FxRate | None:
    q = db.query(FxRate).filter(FxRate.base == base, FxRate.quote == quote)
    if at is not None:
        q = q.filter(FxRate.as_of <= at)
    return q.order_by(FxRate.as_of.desc()).first()


def rate(db: Session, base: str, quote: str, at: datetime | None = None) -> Optional[float]:
    base = base.upper(); quote = quote.upper()
    if base == quote:
        return 1.0
    direct = _pick(db, base, quote, at)
    if direct:
        return direct.rate
    inverse = _pick(db, quote, base, at)
    if inverse and inverse.rate:
        return 1.0 / inverse.rate
    # Triangulation via USD if both sides have USD anchors.
    a = _pick(db, base, "USD", at)
    b = _pick(db, "USD", quote, at)
    if a and b:
        return a.rate * b.rate
    return None


def convert(db: Session, amount: float, from_ccy: str, to_ccy: str,
            at: datetime | None = None) -> Optional[float]:
    r = rate(db, from_ccy, to_ccy, at)
    return None if r is None else round(amount * r, 4)


def normalize_amounts(db: Session, rows: list[dict], amount_key: str = "amount",
                      ccy_key: str = "currency",
                      reporting_ccy: str = REPORTING_CCY_DEFAULT,
                      at: datetime | None = None) -> list[dict]:
    """Return rows with a new key `amount_{reporting_ccy}` added.
    Rows with an unknown currency pair get `None` for the normalized amount."""
    out = []
    for r in rows:
        row = dict(r)
        amt = row.get(amount_key)
        ccy = (row.get(ccy_key) or reporting_ccy).upper()
        row[f"{amount_key}_{reporting_ccy.lower()}"] = (
            convert(db, float(amt), ccy, reporting_ccy, at) if amt is not None else None
        )
        row["fx_rate_used"] = rate(db, ccy, reporting_ccy, at) if ccy != reporting_ccy else 1.0
        out.append(row)
    return out

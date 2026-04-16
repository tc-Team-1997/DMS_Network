import json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AisStatement
from ..services.auth import require, Principal
from ..services import aisp as svc

router = APIRouter(prefix="/api/v1/aisp", tags=["open-banking"])


class ConsentIn(BaseModel):
    customer_cid: str
    provider: str
    scopes: list[str] = ["accounts", "balances", "transactions"]


@router.post("/consents")
def new_consent(body: ConsentIn, db: Session = Depends(get_db),
                p: Principal = Depends(require("capture"))):
    return svc.request_consent(db, body.customer_cid, body.provider, body.scopes)


@router.get("/callback")
def callback(state: str = Query(...), code: str = Query(...),
             db: Session = Depends(get_db)):
    try:
        out = svc.complete_consent(db, state, code)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return out


@router.post("/consents/{consent_id}/fetch")
def fetch(consent_id: int, db: Session = Depends(get_db),
          p: Principal = Depends(require("capture"))):
    try:
        rows = svc.fetch_statements(db, consent_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return [{"id": r.id, "account_id": r.account_id,
             "currency": r.currency, "balance": r.balance,
             "transactions": json.loads(r.transactions_json or "[]")} for r in rows]


@router.delete("/consents/{consent_id}")
def revoke(consent_id: int, db: Session = Depends(get_db),
           p: Principal = Depends(require("capture"))):
    try:
        return svc.revoke(db, consent_id)
    except ValueError as e:
        raise HTTPException(404, str(e))

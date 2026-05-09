from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.auth import current_principal, Principal
from ..services.webauthn_svc import (
    start_registration, finish_registration,
    start_authentication, finish_authentication,
    has_valid_stepup,
)
from ..services.stepup.verify import verify_assertion

router = APIRouter(prefix="/api/v1/stepup", tags=["stepup"],
                   dependencies=[Depends(require_api_key)])


class FinishBody(BaseModel):
    credential: dict


class AuthStart(BaseModel):
    action: str
    resource_id: Optional[int] = None


class AuthFinish(BaseModel):
    action: str
    resource_id: Optional[int] = None
    credential: dict


class AssertionVerifyBody(BaseModel):
    """Body for POST /api/v1/stepup/verify — called by Node BEFORE storing the assertion_id."""
    assertion_id: str
    user_id: str
    action_context: Optional[str] = None
    tenant_id: Optional[str] = "nbe"


@router.post("/register/start")
def reg_start(db: Session = Depends(get_db), p: Principal = Depends(current_principal)):
    return start_registration(db, p.sub)


@router.post("/register/finish")
def reg_finish(body: FinishBody, db: Session = Depends(get_db),
               p: Principal = Depends(current_principal)):
    try:
        return finish_registration(db, p.sub, body.credential)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/authenticate/start")
def auth_start(body: AuthStart, db: Session = Depends(get_db),
               p: Principal = Depends(current_principal)):
    return start_authentication(db, p.sub, body.action, body.resource_id)


@router.post("/authenticate/finish")
def auth_finish(body: AuthFinish, db: Session = Depends(get_db),
                p: Principal = Depends(current_principal)):
    try:
        return finish_authentication(db, p.sub, body.action, body.resource_id, body.credential)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/status")
def status(action: str, resource_id: Optional[int] = None,
           db: Session = Depends(get_db), p: Principal = Depends(current_principal)):
    return {"valid": has_valid_stepup(db, p.sub, action, resource_id)}


@router.post("/verify")
def verify(body: AssertionVerifyBody, db: Session = Depends(get_db)):
    """Cryptographically validate a WebAuthn assertion_id before Node stores it.

    Called by the Node spa-api layer (via py-proxy) before persisting the
    assertion_id into wf_actions or aml_hit_suppressions.

    Success  → 200 {verified: true, factor, verified_at, expires_at}
    Failure  → 401 {verified: false, reason}

    Reasons:
      replayed        — assertion_id already consumed (replay attack)
      unknown_or_expired — challenge not found or past the 5-minute TTL
      user_mismatch   — challenge belongs to a different user
    """
    result = verify_assertion(
        db=db,
        assertion_id=body.assertion_id,
        user_id=body.user_id,
        action_context=body.action_context,
        tenant_id=body.tenant_id or "nbe",
    )
    if not result.verified:
        raise HTTPException(status_code=401, detail=result.to_dict())
    return result.to_dict()

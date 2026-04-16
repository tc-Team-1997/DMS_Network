from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import current_principal, Principal
from ..services.webauthn_svc import (
    start_registration, finish_registration,
    start_authentication, finish_authentication,
    has_valid_stepup,
)

router = APIRouter(prefix="/api/v1/stepup", tags=["stepup"])


class FinishBody(BaseModel):
    credential: dict


class AuthStart(BaseModel):
    action: str
    resource_id: Optional[int] = None


class AuthFinish(BaseModel):
    action: str
    resource_id: Optional[int] = None
    credential: dict


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

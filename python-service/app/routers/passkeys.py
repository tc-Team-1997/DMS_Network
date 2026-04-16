from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.passkeys import (
    register_start, register_finish,
    login_start, login_finish,
)

router = APIRouter(prefix="/api/v1/passkeys", tags=["passkeys"])


class CidBody(BaseModel):
    customer_cid: str


class FinishBody(BaseModel):
    customer_cid: str
    credential: dict
    friendly_name: str | None = None


@router.post("/register/start")
def reg_start(body: CidBody):
    return register_start(body.customer_cid)


@router.post("/register/finish")
def reg_finish(body: FinishBody, db: Session = Depends(get_db)):
    try:
        return register_finish(db, body.customer_cid, body.credential, body.friendly_name)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/login/start")
def l_start(body: CidBody, db: Session = Depends(get_db)):
    return login_start(db, body.customer_cid)


@router.post("/login/finish")
def l_finish(body: FinishBody, db: Session = Depends(get_db)):
    try:
        return login_finish(db, body.customer_cid, body.credential)
    except ValueError as e:
        raise HTTPException(401, str(e))

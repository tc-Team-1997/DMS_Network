from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.zkkyc import issue, verify_proof, revoke, CLAIMS

router = APIRouter(prefix="/api/v1/zk", tags=["zero-knowledge"])


class IssueIn(BaseModel):
    customer_cid: str
    claim: str
    ttl_days: int = 90


class VerifyIn(BaseModel):
    proof_token: str
    customer_cid: Optional[str] = None
    nonce: Optional[str] = None


class RevokeIn(BaseModel):
    commitment: str


@router.get("/claims")
def claims(p: Principal = Depends(require("view"))):
    return {"supported": sorted(CLAIMS.keys())}


@router.post("/issue")
def issue_proof(body: IssueIn, db: Session = Depends(get_db),
                p: Principal = Depends(require("approve"))):
    try:
        return issue(db, body.customer_cid, body.claim, body.ttl_days)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/verify")
def verify(body: VerifyIn, db: Session = Depends(get_db)):
    # Public endpoint — third parties need to verify without a DMS login.
    return verify_proof(db, body.proof_token, body.customer_cid, body.nonce)


@router.post("/revoke")
def revoke_proof(body: RevokeIn, db: Session = Depends(get_db),
                 p: Principal = Depends(require("admin"))):
    try:
        return revoke(db, body.commitment)
    except ValueError as e:
        raise HTTPException(404, str(e))

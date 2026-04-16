from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..services.auth import require, Principal
from ..services.transparency import publish, verify, roots

router = APIRouter(prefix="/api/v1/transparency", tags=["transparency"])


@router.post("/publish")
def publish_root(hour_offset: int = Query(0, ge=0, le=48),
                 p: Principal = Depends(require("admin"))):
    return publish(hour_offset)


@router.get("/roots")
def list_roots(limit: int = 24,
               p: Principal = Depends(require("audit_read"))):
    return roots(limit)


class VerifyIn(BaseModel):
    window_start: str


@router.post("/verify")
def verify_root(body: VerifyIn):
    return verify(body.window_start)   # Public on purpose — verification endpoint.

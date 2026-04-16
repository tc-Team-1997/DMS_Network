from fastapi import APIRouter, Depends

from ..services.auth import require, Principal
from ..services.ledger import backend, verify_journal, tail

router = APIRouter(prefix="/api/v1/ledger", tags=["ledger"])


@router.get("/backend")
def info(p: Principal = Depends(require("audit_read"))):
    return {"backend": backend()}


@router.get("/verify")
def verify(p: Principal = Depends(require("audit_read"))):
    return verify_journal()


@router.get("/tail")
def tail_log(lines: int = 100, p: Principal = Depends(require("audit_read"))):
    return {"count": lines, "events": tail(lines)}

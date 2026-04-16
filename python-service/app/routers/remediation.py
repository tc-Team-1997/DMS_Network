from fastapi import APIRouter, Depends

from ..services.auth import require, Principal
from ..services.remediation import tickets
from ..services.waf import current_mode

router = APIRouter(prefix="/api/v1/remediation", tags=["remediation"])


@router.get("/tickets")
def list_tickets(limit: int = 50, p: Principal = Depends(require("audit_read"))):
    return tickets(limit)


@router.get("/waf-mode")
def waf_mode(p: Principal = Depends(require("audit_read"))):
    return {"mode": current_mode()}

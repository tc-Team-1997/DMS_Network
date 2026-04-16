from fastapi import APIRouter, Depends
from pydantic import BaseModel
from pathlib import Path

from ..services.auth import require, Principal
from ..services.siem import ship, AUDIT_FILE

router = APIRouter(prefix="/api/v1/siem", tags=["siem"])


class AuditEvent(BaseModel):
    type: str
    data: dict = {}


@router.post("/ship")
def ship_event(ev: AuditEvent, p: Principal = Depends(require("admin"))):
    return ship({"type": ev.type, **ev.data, "shipped_by": p.sub})


@router.get("/tail")
def tail(lines: int = 100, p: Principal = Depends(require("audit_read"))):
    if not AUDIT_FILE.exists():
        return {"file": str(AUDIT_FILE), "lines": []}
    with open(AUDIT_FILE, encoding="utf-8") as f:
        all_lines = f.readlines()
    return {"file": str(AUDIT_FILE), "lines": all_lines[-lines:]}

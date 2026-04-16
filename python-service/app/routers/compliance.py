from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.compliance import run, latest

router = APIRouter(prefix="/api/v1/compliance", tags=["compliance"])


@router.post("/run")
def measure(db: Session = Depends(get_db),
            p: Principal = Depends(require("audit_read"))):
    return run(db, p.tenant)


@router.get("/latest")
def history(days: int = 7, db: Session = Depends(get_db),
            p: Principal = Depends(require("audit_read"))):
    return latest(db, p.tenant, days)

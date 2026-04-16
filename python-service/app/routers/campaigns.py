from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.expiry_campaign import run_campaign

router = APIRouter(prefix="/api/v1/campaigns", tags=["campaigns"])


@router.post("/expiry/run")
def expiry_run(dry_run: bool = Query(True),
               db: Session = Depends(get_db),
               p: Principal = Depends(require("admin"))):
    return run_campaign(db, p.tenant, dry_run=dry_run, actor=p.sub)

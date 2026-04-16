from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.cbe_reports import kyc_compliance, document_inventory, audit_trail, to_csv

router = APIRouter(prefix="/api/v1/cbe", tags=["cbe"])


@router.get("/kyc-compliance")
def kyc(format: str = Query("json", pattern="^(json|csv)$"),
        db: Session = Depends(get_db),
        p: Principal = Depends(require("audit_read"))):
    r = kyc_compliance(db, p.tenant)
    if format == "csv":
        return Response(to_csv(r), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="cbe-kyc.csv"'})
    return r


@router.get("/document-inventory")
def inventory(format: str = Query("json", pattern="^(json|csv)$"),
              db: Session = Depends(get_db),
              p: Principal = Depends(require("audit_read"))):
    r = document_inventory(db, p.tenant)
    if format == "csv":
        return Response(to_csv(r), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="cbe-inventory.csv"'})
    return r


@router.get("/audit-trail")
def audit(customer_cid: Optional[str] = None, doc_type: Optional[str] = None,
          since_days: int = 90, format: str = Query("json", pattern="^(json|csv)$"),
          db: Session = Depends(get_db),
          p: Principal = Depends(require("audit_read"))):
    r = audit_trail(db, customer_cid, doc_type, since_days, p.tenant)
    if format == "csv":
        return Response(to_csv(r), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="cbe-audit.csv"'})
    return r

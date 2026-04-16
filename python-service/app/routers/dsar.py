from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.dsar import export, erase

router = APIRouter(prefix="/api/v1/dsar", tags=["dsar"])


@router.get("/export/{customer_cid}")
def export_data(customer_cid: str, db: Session = Depends(get_db),
                p: Principal = Depends(require("admin"))):
    blob = export(db, customer_cid)
    return Response(content=blob, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="dsar-{customer_cid}.zip"'})


@router.delete("/erase/{customer_cid}")
def erase_data(customer_cid: str, db: Session = Depends(get_db),
               p: Principal = Depends(require("admin"))):
    return erase(db, customer_cid, p.sub)

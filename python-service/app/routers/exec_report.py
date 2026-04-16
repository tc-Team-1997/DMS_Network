from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.exec_report import build

router = APIRouter(prefix="/api/v1/reports/exec", tags=["executive-report"])


@router.post("/build")
def build_report(db: Session = Depends(get_db),
                 p: Principal = Depends(require("admin"))):
    out, data = build(db, p.tenant)
    return {"path": str(out), "summary": data}


@router.get("/download")
def download(db: Session = Depends(get_db),
             p: Principal = Depends(require("admin"))):
    out, _ = build(db, p.tenant)
    return FileResponse(out, media_type="application/pdf",
                        filename=out.name)

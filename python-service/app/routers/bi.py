from fastapi import APIRouter, Depends
from ..services.auth import require, Principal
from ..services.etl import run_all, create_semantic_views

router = APIRouter(prefix="/api/v1/bi", tags=["bi"])


@router.post("/etl/run")
def etl_run(p: Principal = Depends(require("admin"))):
    return run_all()


@router.post("/views/refresh")
def views_refresh(p: Principal = Depends(require("admin"))):
    create_semantic_views()
    return {"ok": True}

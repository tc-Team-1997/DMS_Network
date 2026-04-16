from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..services.auth import require, Principal
from ..services.carbon import snapshot, estimate_workflow

router = APIRouter(prefix="/api/v1/sustainability", tags=["sustainability"])


@router.get("/snapshot")
def get_snapshot(p: Principal = Depends(require("audit_read"))):
    return snapshot()


class WorkflowIn(BaseModel):
    cpu_seconds: float


@router.post("/estimate")
def estimate(body: WorkflowIn, p: Principal = Depends(require("audit_read"))):
    return estimate_workflow(body.cpu_seconds)

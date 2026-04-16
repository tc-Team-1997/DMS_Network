from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..services.auth import require, Principal
from ..services.journey import run, run_all, JOURNEYS, DEFAULT_BASE

router = APIRouter(prefix="/api/v1/journey", tags=["journey-simulator"])


class RunOne(BaseModel):
    name: str
    base: str | None = None
    api_key: str | None = None


@router.get("")
def list_journeys(p: Principal = Depends(require("admin"))):
    return {"journeys": sorted(JOURNEYS.keys()), "default_base": DEFAULT_BASE}


@router.post("/run")
def run_one(body: RunOne, p: Principal = Depends(require("admin"))):
    return run(body.name, body.base or DEFAULT_BASE, body.api_key or "dev-key-change-me")


@router.post("/run-all")
def run_every(p: Principal = Depends(require("admin"))):
    return run_all()

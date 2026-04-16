from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..services.auth import require, Principal
from ..services.redteam import run, BASE_DEFAULT
from ..services.events import emit

router = APIRouter(prefix="/api/v1/redteam", tags=["redteam"])


class RunIn(BaseModel):
    base: str | None = None
    api_key: str | None = None


@router.post("/run")
def run_redteam(body: RunIn, p: Principal = Depends(require("admin"))):
    r = run(body.base or BASE_DEFAULT, body.api_key)
    emit("redteam.run", verdict=r["verdict"], score=r["score"],
         passed=r["passed"], attempted=r["attempted"])
    return r

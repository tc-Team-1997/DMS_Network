from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from ..services.auth import require, Principal
from ..services.stride import build, build_markdown

router = APIRouter(prefix="/api/v1/threat-model", tags=["threat-model"])


@router.get("")
def model(p: Principal = Depends(require("audit_read"))):
    return build()


@router.get("/markdown", response_class=PlainTextResponse)
def md(p: Principal = Depends(require("audit_read"))):
    return build_markdown()

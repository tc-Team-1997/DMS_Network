from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
import json

from ..services.auth import require, Principal
from ..services.lineage import build

router = APIRouter(prefix="/api/v1/lineage", tags=["data-lineage"])


@router.get("")
def lineage(format: str = Query("json", pattern="^(json|openlineage)$"),
            p: Principal = Depends(require("audit_read"))):
    g = build()
    if format == "openlineage":
        return Response(json.dumps({"datasets": g["datasets"]}, indent=2),
                        media_type="application/json")
    return g


@router.get("/field/{name}")
def field(name: str, p: Principal = Depends(require("audit_read"))):
    g = build()
    return {"field": name, **g["fields_of_interest"].get(name, {"reads": [], "writes": []})}

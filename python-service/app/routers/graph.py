from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.graph_analytics import build_graph, find_rings, neighbors

router = APIRouter(prefix="/api/v1/graph", tags=["graph"])


@router.get("")
def graph(db: Session = Depends(get_db),
          p: Principal = Depends(require("audit_read"))):
    return build_graph(db, p.tenant)


@router.get("/rings")
def rings(min_weight: int = 6, max_cycle_len: int = 5,
          db: Session = Depends(get_db),
          p: Principal = Depends(require("audit_read"))):
    return {"tenant": p.tenant, "rings": find_rings(db, p.tenant, min_weight, max_cycle_len)}


@router.get("/neighbors/{customer_cid}")
def neighborhood(customer_cid: str, depth: int = Query(2, ge=1, le=4),
                 db: Session = Depends(get_db),
                 p: Principal = Depends(require("audit_read"))):
    return neighbors(db, customer_cid, p.tenant, depth)

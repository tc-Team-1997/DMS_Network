from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.blast_radius import compute

router = APIRouter(prefix="/api/v1/blast-radius", tags=["blast-radius"])


@router.get("/{doc_id}")
def radius(doc_id: int, db: Session = Depends(get_db),
           p: Principal = Depends(require("approve"))):
    r = compute(db, doc_id)
    if r.get("error"):
        raise HTTPException(404, r["error"])
    return r

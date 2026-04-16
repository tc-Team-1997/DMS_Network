from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.test_data import generate, purge

router = APIRouter(prefix="/api/v1/test-data", tags=["test-data"])


@router.post("/generate")
def gen(n_customers: int = Query(50, ge=1, le=5000),
        docs_per_customer: int = Query(3, ge=1, le=10),
        db: Session = Depends(get_db),
        p: Principal = Depends(require("admin"))):
    return generate(db, n_customers, docs_per_customer)


@router.delete("/purge")
def purge_all(db: Session = Depends(get_db),
              p: Principal = Depends(require("admin"))):
    return purge(db)

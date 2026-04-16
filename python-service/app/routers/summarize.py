from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.summarize import summarize_loan_file

router = APIRouter(prefix="/api/v1/summarize", tags=["summarize"])


@router.get("/loan/{customer_cid}")
def loan_brief(customer_cid: str, db: Session = Depends(get_db),
               p: Principal = Depends(require("approve"))):
    return summarize_loan_file(db, customer_cid)

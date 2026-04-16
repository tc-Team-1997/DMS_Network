from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.compliance_coach import coach

router = APIRouter(prefix="/api/v1/coach", tags=["compliance-coach"])


@router.get("/{doc_id}")
def explain(doc_id: int, db: Session = Depends(get_db),
            p: Principal = Depends(require("approve"))):
    return coach(db, doc_id)

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.doc_diff import diff

router = APIRouter(prefix="/api/v1/diff", tags=["semantic-diff"])


@router.get("/{a}/{b}")
def semantic_diff(a: int, b: int, db: Session = Depends(get_db),
                  p: Principal = Depends(require("view"))):
    return diff(db, a, b)

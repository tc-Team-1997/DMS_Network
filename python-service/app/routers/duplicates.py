from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document, DuplicateMatch
from ..schemas import DuplicateOut
from ..security import require_api_key
from ..services.duplicates import find_duplicates

router = APIRouter(prefix="/api/v1/duplicates", tags=["duplicates"], dependencies=[Depends(require_api_key)])


@router.post("/{doc_id}/scan", response_model=List[DuplicateOut])
def scan(doc_id: int, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return find_duplicates(db, doc)


@router.get("/{doc_id}", response_model=List[DuplicateOut])
def list_for_doc(doc_id: int, db: Session = Depends(get_db)):
    return (
        db.query(DuplicateMatch)
        .filter((DuplicateMatch.doc_a == doc_id) | (DuplicateMatch.doc_b == doc_id))
        .all()
    )

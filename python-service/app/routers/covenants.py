from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.covenants import extract_for_document, list_for_document

router = APIRouter(prefix="/api/v1/covenants", tags=["covenants"])


@router.post("/{doc_id}/extract")
def extract(doc_id: int, db: Session = Depends(get_db),
            p: Principal = Depends(require("approve"))):
    r = extract_for_document(db, doc_id)
    if r.get("error"):
        raise HTTPException(404 if r["error"] == "not_found" else 400, r["error"])
    return r


@router.get("/{doc_id}")
def list_for_doc(doc_id: int, db: Session = Depends(get_db),
                 p: Principal = Depends(require("view"))):
    return list_for_document(db, doc_id)

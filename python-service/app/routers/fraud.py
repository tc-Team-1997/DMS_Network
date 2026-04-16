from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document
from ..services.auth import require, Principal
from ..services.fraud import score
from ..services.events import emit

router = APIRouter(prefix="/api/v1/fraud", tags=["fraud"])


@router.get("/{doc_id}")
def get_score(doc_id: int, db: Session = Depends(get_db),
              p: Principal = Depends(require("approve"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    result = score(db, doc)
    if result["band"] in ("high", "critical"):
        emit("fraud.alert", document_id=doc.id, score=result["score"], band=result["band"])
    return result

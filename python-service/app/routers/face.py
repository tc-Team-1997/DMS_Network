from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document
from ..services.auth import require, Principal
from ..services.face import compare

router = APIRouter(prefix="/api/v1/face", tags=["face"])


@router.post("/{doc_id}/match")
async def match(doc_id: int, selfie: UploadFile = File(...),
                db: Session = Depends(get_db),
                p: Principal = Depends(require("approve"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    result = compare(doc.filename, await selfie.read())
    return {"document_id": doc.id, **result}

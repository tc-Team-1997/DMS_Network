from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.stamp_search import ingest_document, search

router = APIRouter(prefix="/api/v1/stamps", tags=["stamp-search"])


@router.post("/ingest/{doc_id}")
def ingest(doc_id: int, db: Session = Depends(get_db),
           p: Principal = Depends(require("index"))):
    r = ingest_document(db, doc_id)
    if r.get("ok") is False:
        raise HTTPException(400, r)
    return r


@router.post("/search")
async def stamp_search(query: UploadFile = File(...), top_k: int = 10,
                       db: Session = Depends(get_db),
                       p: Principal = Depends(require("view"))):
    return search(db, await query.read(), top_k)

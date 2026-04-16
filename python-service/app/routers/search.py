from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import DocumentOut
from ..security import require_api_key
from ..services.search_backend import search as backend_search, is_elastic_enabled

router = APIRouter(prefix="/api/v1/search", tags=["search"], dependencies=[Depends(require_api_key)])


@router.get("", response_model=List[DocumentOut])
def search(
    q: Optional[str] = Query(None, description="Full-text query across OCR and metadata"),
    doc_type: Optional[str] = None,
    branch: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    return backend_search(db, q, doc_type, branch, status, limit)


@router.get("/backend")
def backend_info():
    return {"elasticsearch": is_elastic_enabled()}

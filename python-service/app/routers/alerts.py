from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.alerts import expiring_documents, low_confidence_ocr

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"], dependencies=[Depends(require_api_key)])


@router.get("/expiring")
def expiring(within_days: int = 30, db: Session = Depends(get_db)):
    return expiring_documents(db, within_days)


@router.get("/ocr-low-confidence")
def ocr_low(threshold: float = 0.9, db: Session = Depends(get_db)):
    return low_confidence_ocr(db, threshold)

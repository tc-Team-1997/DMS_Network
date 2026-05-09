from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.alerts import (
    expiring_documents,
    expiring_documents_per_doctype,
    low_confidence_ocr,
    create_alert,
)

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"], dependencies=[Depends(require_api_key)])


@router.get("/expiring")
def expiring(within_days: int = 30, db: Session = Depends(get_db)):
    return expiring_documents(db, within_days)


@router.get("/expiring-per-doctype")
def expiring_per_doctype(db: Session = Depends(get_db)):
    """Return documents approaching expiry grouped by per-doctype notify_days bands.

    Replaces the hardcoded 30-day / 90-day defaults — each document type
    controls its own notification thresholds via notify_days (migration 0031).
    """
    return expiring_documents_per_doctype(db)


@router.get("/ocr-low-confidence")
def ocr_low(threshold: float = 0.9, db: Session = Depends(get_db)):
    return low_confidence_ocr(db, threshold)


class AlertIn(BaseModel):
    user_id: str
    level: Literal["info", "warning", "critical"] = "info"
    title: str
    message: Optional[str] = ""


@router.post("")
def post_alert(body: AlertIn, db: Session = Depends(get_db)):
    """Create a new alert and fire best-effort multi-channel notification."""
    return create_alert(
        db,
        user_id=body.user_id,
        level=body.level,
        title=body.title,
        message=body.message or "",
    )

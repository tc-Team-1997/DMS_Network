from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..db import get_db
from ..models import Document, WorkflowStep
from ..security import require_api_key

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"], dependencies=[Depends(require_api_key)])


@router.get("/kpis")
def kpis(db: Session = Depends(get_db)):
    total = db.query(func.count(Document.id)).scalar() or 0
    indexed = db.query(func.count(Document.id)).filter(Document.status.in_(["indexed", "archived"])).scalar() or 0
    pending = db.query(func.count(Document.id)).filter(Document.status.in_(["maker", "checker", "approve"])).scalar() or 0
    today = datetime.utcnow().date()
    soon = (today + timedelta(days=30)).isoformat()
    expiring = db.query(func.count(Document.id)).filter(
        Document.expiry_date != None,
        Document.expiry_date <= soon,
    ).scalar() or 0
    ocr_rate = round(indexed / total * 100, 1) if total else 0.0
    return {
        "total_documents": total,
        "ocr_processed_pct": ocr_rate,
        "pending_approvals": pending,
        "expiring_documents": expiring,
    }


@router.get("/inflow")
def inflow(days: int = 7, db: Session = Depends(get_db)):
    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(func.date(Document.created_at), func.count(Document.id))
        .filter(Document.created_at >= since)
        .group_by(func.date(Document.created_at))
        .all()
    )
    return [{"date": str(d), "count": c} for d, c in rows]

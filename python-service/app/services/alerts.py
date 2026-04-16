from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from ..models import Document


def expiring_documents(db: Session, within_days: int = 30) -> list[dict]:
    today = datetime.utcnow().date()
    cutoff = (today + timedelta(days=within_days)).isoformat()
    docs = (
        db.query(Document)
        .filter(Document.expiry_date != None, Document.expiry_date <= cutoff)
        .all()
    )
    out = []
    for d in docs:
        try:
            exp = datetime.strptime(d.expiry_date, "%Y-%m-%d").date()
            days_left = (exp - today).days
        except Exception:
            days_left = None
        out.append({
            "id": d.id,
            "original_name": d.original_name,
            "customer_cid": d.customer_cid,
            "doc_type": d.doc_type,
            "expiry_date": d.expiry_date,
            "days_left": days_left,
            "severity": (
                "critical" if days_left is not None and days_left < 0
                else "warning" if days_left is not None and days_left <= 7
                else "info"
            ),
        })
    return out


def low_confidence_ocr(db: Session, threshold: float = 0.9) -> list[dict]:
    from ..models import OcrResult
    rows = (
        db.query(OcrResult, Document)
        .join(Document, Document.id == OcrResult.document_id)
        .filter(OcrResult.confidence < threshold)
        .all()
    )
    return [
        {"document_id": o.document_id, "confidence": o.confidence,
         "original_name": d.original_name, "doc_type": d.doc_type}
        for o, d in rows
    ]

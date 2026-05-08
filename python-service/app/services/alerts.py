from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from ..models import Document

log = logging.getLogger(__name__)


def _fire_notify_best_effort(user_id: str, subject: str, body: str, db: Session) -> None:
    """Fire notify.send in the background without blocking the caller.

    Swallows all exceptions — this is a best-effort side-effect.
    """
    try:
        from ..services import notify as notify_svc

        async def _send():
            try:
                await notify_svc.send(
                    user_id=user_id,
                    event_type="alert",
                    subject=subject,
                    body=body,
                    db=db,
                )
            except Exception as exc:
                log.warning("notify best-effort failed: %s", exc)

        # If we're in an async context, schedule a task; otherwise run in new loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_send())
            else:
                loop.run_until_complete(_send())
        except RuntimeError:
            asyncio.run(_send())

    except Exception as exc:
        log.warning("notify fire-and-forget error: %s", exc)


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


def create_alert(
    db: Session,
    *,
    user_id: str,
    level: str,
    title: str,
    message: str,
) -> dict:
    """Persist an alert and fire a best-effort multi-channel notification.

    ``level`` should be one of: info | warning | critical.
    The DB write is authoritative; notify failure never blocks the response.
    """
    from ..models import AlertRecord

    record = AlertRecord(
        user_sub=user_id,
        level=level,
        title=title,
        message=message,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # Fire-and-forget notification
    subject_prefix = {
        "critical": "[CRITICAL]",
        "warning":  "[WARNING]",
    }.get(level, "[INFO]")
    _fire_notify_best_effort(
        user_id=user_id,
        subject=f"{subject_prefix} {title}",
        body=message,
        db=db,
    )

    return {
        "id": record.id,
        "user_sub": record.user_sub,
        "level": record.level,
        "title": record.title,
        "message": record.message,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


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

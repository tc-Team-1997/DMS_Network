from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from ..models import Document, DocumentTypeSchema

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


def _parse_notify_days(raw: Optional[str]) -> list[int]:
    """Parse a comma-separated notify_days string into a sorted list of ints.

    Falls back to [30, 60, 90] when the column is NULL, empty, or malformed.
    """
    if not raw:
        return [30, 60, 90]
    parts: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            days = int(part)
            if days > 0:
                parts.append(days)
    return sorted(set(parts)) if parts else [30, 60, 90]


def expiring_documents_per_doctype(db: Session) -> list[dict]:
    """Return expiring documents grouped by per-doctype notify_days bands.

    Each result row carries a ``band_days`` key so callers know which
    notification threshold triggered the alert.  Documents expiring beyond
    the largest band are excluded (they will be caught on the next run when
    the distance crosses the band).

    This replaces the hardcoded 30-day default (UI/UX line #14).
    """
    today = datetime.utcnow().date()
    out: list[dict] = []

    # Fetch all active doctype schemas so we can read their notify_days.
    doctypes = (
        db.query(DocumentTypeSchema)
        .filter(DocumentTypeSchema.active == 1)
        .all()
    )
    # Build a mapping: doc_type name → sorted notify_days list
    notify_map: dict[str, list[int]] = {}
    for dt in doctypes:
        notify_map[dt.name] = _parse_notify_days(dt.notify_days)

    # Fallback bands for documents whose doc_type doesn't match any schema.
    default_bands = [30, 60, 90]

    # Query all non-expired documents that have an expiry_date.
    docs = (
        db.query(Document)
        .filter(Document.expiry_date.isnot(None))
        .all()
    )

    seen_ids: set[int] = set()
    for d in docs:
        try:
            exp = datetime.strptime(d.expiry_date, "%Y-%m-%d").date()
            days_left = (exp - today).days
        except Exception:
            continue

        bands = notify_map.get(d.doc_type or "", default_bands)
        max_band = max(bands)

        # Only surface documents within the widest band.
        if days_left > max_band:
            continue

        # Identify the narrowest band that still covers days_left.
        matched_band: Optional[int] = None
        for band in bands:
            if days_left <= band:
                matched_band = band
                break

        if matched_band is None:
            continue

        if d.id in seen_ids:
            continue
        seen_ids.add(d.id)

        out.append({
            "id": d.id,
            "original_name": d.original_name,
            "customer_cid": d.customer_cid,
            "doc_type": d.doc_type,
            "expiry_date": d.expiry_date,
            "days_left": days_left,
            "band_days": matched_band,
            "severity": (
                "critical" if days_left < 0
                else "warning" if days_left <= 7
                else "info"
            ),
        })

    return out


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

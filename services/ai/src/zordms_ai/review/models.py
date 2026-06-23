from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from zordms_ai.db import Base


def _utcnow() -> datetime:
    """Return the current UTC time as a naive datetime (strips tzinfo for DB compat)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ReviewItem(Base):
    __tablename__ = "review_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_id: Mapped[str] = mapped_column(String(64), index=True)
    doc_type: Mapped[str] = mapped_column(String(40))
    confidence: Mapped[float] = mapped_column(Float)
    band: Mapped[str] = mapped_column(String(20))
    sla_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)
    claimed_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Resolution extended to 255 chars to avoid silent truncation on Postgres/Oracle (F-07)
    resolution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    # Use lambda to avoid deprecated datetime.utcnow (F-04)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

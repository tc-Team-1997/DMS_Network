from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

REVIEW_THRESHOLD = 0.85


class Sex(str, Enum):
    M = "M"
    F = "F"
    O = "O"


class SourceChannel(str, Enum):
    SCAN = "SCAN"
    UPLOAD = "UPLOAD"
    EMAIL = "EMAIL"
    BaNCS_FEED = "BaNCS_FEED"


def iso_date(value: str | date) -> date:
    """Parse an ISO-8601 date string (or pass through a date). Raises ValueError."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        return date.fromisoformat(value)  # raises ValueError on bad format
    raise ValueError(f"not an ISO-8601 date: {value!r}")


class ExtractionBase(BaseModel):
    doc_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    review_flag: bool = False

    @model_validator(mode="after")
    def _set_review_flag(self) -> "ExtractionBase":
        self.review_flag = self.confidence < REVIEW_THRESHOLD
        return self


class SystemMetadata(BaseModel):
    doc_id: UUID
    file_hash_sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    ingest_timestamp: datetime
    source_channel: SourceChannel
    ingest_user_id: str
    raw_file_path: str
    page_count: int = Field(ge=1)
    file_size_bytes: int = Field(ge=0)
    ocr_engine: str
    processing_ms: int = Field(ge=0)
    retention_years: int = Field(ge=0)
    destruction_date: date

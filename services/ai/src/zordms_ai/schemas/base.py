from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field, model_validator

REVIEW_THRESHOLD = 0.85


class Sex(str, Enum):
    M = "M"
    F = "F"
    O = "O"


# --- Lenient coercion for real-world VLM output ----------------------------
# Vision models emit human-friendly values ("Male", "25/03/1983") rather than
# canonical ones. These before-validators normalise common variants so a good
# extraction isn't rejected on formatting alone; anything unrecognised is passed
# through unchanged so pydantic still raises (→ review), never silently wrong.

_DATE_FORMATS = (
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d",
    "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%d-%b-%Y",
)


def parse_flexible_date(v: object) -> object:
    """Parse ISO or common DD/MM/YYYY-style dates; DD/MM precedence (BT/IN)."""
    if v is None or isinstance(v, (date, datetime)):
        return v
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
    return v  # let pydantic raise its standard error → review_flag


_SEX_MAP = {
    "m": Sex.M, "male": Sex.M,
    "f": Sex.F, "female": Sex.F,
    "o": Sex.O, "other": Sex.O, "x": Sex.O,
}


def normalize_sex(v: object) -> object:
    """Map 'Male'/'Female'/'M'/'F'/... to the Sex enum; blanks → None."""
    if v is None or isinstance(v, Sex):
        return v
    if isinstance(v, str):
        key = v.strip().lower()
        if not key:
            return None
        if key in _SEX_MAP:
            return _SEX_MAP[key]
    return v


# Annotated types schemas can use directly: `dob: FlexibleDate | None = None`.
FlexibleDate = Annotated[date, BeforeValidator(parse_flexible_date)]
FlexibleSex = Annotated[Sex, BeforeValidator(normalize_sex)]


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

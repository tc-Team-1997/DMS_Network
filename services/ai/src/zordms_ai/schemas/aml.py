from __future__ import annotations

from typing import Literal

from pydantic import Field

from zordms_ai.schemas.base import ExtractionBase, FlexibleDate


class SarReport(ExtractionBase):
    """Suspicious Activity Report. Mandatory regulatory fields (per compliance
    rules): subject, amount, report_date."""

    doc_type: Literal["SAR_REPORT"] = "SAR_REPORT"
    subject: str = Field(min_length=1, description="Subject / reported party")
    amount: float = Field(ge=0)
    report_date: FlexibleDate
    case_count: int | None = Field(default=None, ge=0)
    total_flagged: float | None = Field(default=None, ge=0)
    narrative: str | None = Field(default=None, max_length=4000)


class Ctr(ExtractionBase):
    """Currency Transaction Report. Mandatory: amount, transaction_date."""

    doc_type: Literal["CTR"] = "CTR"
    amount: float = Field(ge=0)
    transaction_date: FlexibleDate
    currency: str | None = Field(default=None, max_length=8)
    account_no: str | None = Field(default=None, max_length=40)
    customer_name: str | None = Field(default=None, max_length=160)

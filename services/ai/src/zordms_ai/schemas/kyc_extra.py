from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from zordms_ai.schemas.base import ExtractionBase, FlexibleDate, FlexibleSex


class ForeignPassport(ExtractionBase):
    """Non-Bhutanese passport. Looser than BTPassport: passport-number formats
    vary by country, so only a non-empty string is required; nationality is
    mandatory (it's the point of a foreign passport)."""

    doc_type: Literal["FOREIGN_PASSPORT"] = "FOREIGN_PASSPORT"
    passport_no: str = Field(min_length=1, max_length=20)
    full_name: str = Field(min_length=1)
    nationality: str = Field(min_length=1, description="ISO country / nationality")
    dob: FlexibleDate | None = None
    sex: FlexibleSex | None = None
    place_of_issue: str | None = None
    issue_date: FlexibleDate | None = None
    expiry_date: FlexibleDate | None = None
    mrz_line1: str | None = None
    mrz_line2: str | None = None

    @model_validator(mode="after")
    def _date_rules(self) -> "ForeignPassport":
        if self.issue_date and self.issue_date > date.today():
            raise ValueError("issue_date must be <= today")
        if self.issue_date and self.expiry_date and self.expiry_date <= self.issue_date:
            raise ValueError("expiry_date must be after issue_date")
        return self


class InPan(ExtractionBase):
    """Indian PAN card. PAN format is AAAAA9999A."""

    doc_type: Literal["IN_PAN"] = "IN_PAN"
    pan_no: str = Field(pattern=r"^[A-Z]{5}[0-9]{4}[A-Z]$")
    name: str = Field(min_length=1)
    fathers_name: str | None = Field(default=None, max_length=120)
    dob: FlexibleDate | None = None


class InAadhaar(ExtractionBase):
    """Indian Aadhaar card. Aadhaar is a 12-digit number."""

    doc_type: Literal["IN_AADHAAR"] = "IN_AADHAAR"
    aadhaar_no: str = Field(pattern=r"^[0-9]{12}$")
    name: str = Field(min_length=1)
    address: str | None = Field(default=None, max_length=300)
    dob: FlexibleDate | None = None
    sex: FlexibleSex | None = None

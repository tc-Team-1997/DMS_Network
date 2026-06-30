from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from zordms_ai.schemas.base import ExtractionBase, FlexibleDate, FlexibleSex


class BTPassport(ExtractionBase):
    doc_type: Literal["BT_PASSPORT"] = "BT_PASSPORT"
    passport_no: str = Field(pattern=r"^[A-Z][0-9]{7}$")
    surname: str = Field(min_length=1)
    given_names: str = Field(min_length=1)
    nationality: str = "BTN"
    dob: FlexibleDate
    sex: FlexibleSex | None = None
    place_of_birth: str | None = None
    issue_date: FlexibleDate
    expiry_date: FlexibleDate
    mrz_line1: str | None = None
    mrz_line2: str | None = None

    @model_validator(mode="after")
    def _date_rules(self) -> "BTPassport":
        """Cross-field date validation — mirrors BTCid4G (F-05)."""
        if self.issue_date > date.today():
            raise ValueError("issue_date must be <= today")
        if self.expiry_date <= self.issue_date:
            raise ValueError("expiry_date must be after issue_date")
        return self

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field

from zordms_ai.schemas.base import ExtractionBase, Sex


class BTPassport(ExtractionBase):
    doc_type: Literal["BT_PASSPORT"] = "BT_PASSPORT"
    passport_no: str = Field(pattern=r"^[A-Z][0-9]{7}$")
    surname: str = Field(min_length=1)
    given_names: str = Field(min_length=1)
    nationality: str = "BTN"
    dob: date
    sex: Sex | None = None
    place_of_birth: str | None = None
    issue_date: date
    expiry_date: date
    mrz_line1: str | None = None
    mrz_line2: str | None = None

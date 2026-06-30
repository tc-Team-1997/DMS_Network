from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from zordms_ai.schemas.base import ExtractionBase, Sex
from zordms_ai.schemas.cid import Dzongkhag


class BTCitizenship(ExtractionBase):
    """Bhutan Citizenship Certificate (issued by DCRC).

    Distinct from the BT_CID_4G card: it references the holder's CID number and
    name (the two regulatory-mandatory fields) plus civil-registration details
    (sex, dzongkhag, gewog, issue date) that the UI surfaces as optional. Only
    cid_no and full_name are required so ordinary OCR variance doesn't force the
    whole document into review — missing optional fields simply stay null.
    """

    doc_type: Literal["BT_CITIZENSHIP"] = "BT_CITIZENSHIP"
    cid_no: str = Field(min_length=1, description="CID number referenced on the certificate")
    full_name: str = Field(min_length=1)
    fathers_name: str | None = Field(default=None, max_length=120)
    dob: date | None = None
    sex: Sex | None = None
    dzongkhag: Dzongkhag | None = None
    gewog: str | None = Field(default=None, max_length=100)
    village: str | None = Field(default=None, max_length=100)
    issue_date: date | None = None

    @model_validator(mode="after")
    def _date_rules(self) -> "BTCitizenship":
        if self.issue_date is not None and self.issue_date > date.today():
            raise ValueError("issue_date must be <= today")
        if self.dob is not None:
            age = (date.today() - self.dob).days / 365.25
            if not (0 <= age <= 120):
                raise ValueError("dob age out of range 0-120")
        return self

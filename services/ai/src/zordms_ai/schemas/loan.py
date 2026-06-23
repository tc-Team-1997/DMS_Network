from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import Field

from zordms_ai.schemas.base import ExtractionBase


class LoanType(str, Enum):
    HOME = "HOME"
    AUTO = "AUTO"
    AGRI = "AGRI"
    BUSINESS = "BUSINESS"
    PERSONAL = "PERSONAL"


class BOBLoanApplication(ExtractionBase):
    doc_type: Literal["BOB_LOAN_APPLICATION"] = "BOB_LOAN_APPLICATION"
    application_no: str = Field(min_length=1)
    applicant_cid: str = Field(pattern=r"^[0-9]{11}$")
    applicant_name: str = Field(min_length=1)
    loan_type: LoanType
    loan_amount: float = Field(ge=0)
    branch_code: str = Field(min_length=1)
    submission_date: date
    officer_id: str | None = None

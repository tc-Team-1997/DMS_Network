from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from zordms_ai.schemas.base import ExtractionBase


class BobAccountForm(ExtractionBase):
    """Bank of Bhutan account-opening form. account_no + customer_name are the
    identifying pair; the rest are the UI's optional fields."""

    doc_type: Literal["BOB_ACCOUNT_FORM"] = "BOB_ACCOUNT_FORM"
    account_no: str = Field(min_length=1, max_length=40)
    customer_name: str = Field(min_length=1)
    cid: str | None = Field(default=None, max_length=20)
    account_type: str | None = Field(default=None, max_length=40)
    currency: str | None = Field(default=None, max_length=8)
    date_opened: date | None = None
    officer: str | None = Field(default=None, max_length=120)
    branch_code: str | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def _date_rules(self) -> "BobAccountForm":
        if self.date_opened and self.date_opened > date.today():
            raise ValueError("date_opened must be <= today")
        return self

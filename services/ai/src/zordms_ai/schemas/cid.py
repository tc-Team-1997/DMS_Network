from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import Field, field_validator, model_validator

from zordms_ai.schemas.base import ExtractionBase, FlexibleDate, FlexibleSex


class Dzongkhag(str, Enum):
    Bumthang = "Bumthang"
    Chukha = "Chukha"
    Dagana = "Dagana"
    Gasa = "Gasa"
    Haa = "Haa"
    Lhuntse = "Lhuntse"
    Mongar = "Mongar"
    Paro = "Paro"
    PemaGatshel = "Pema Gatshel"
    Punakha = "Punakha"
    SamdrupJongkhar = "Samdrup Jongkhar"
    Samtse = "Samtse"
    Sarpang = "Sarpang"
    Thimphu = "Thimphu"
    Trashigang = "Trashigang"
    TrashiYangtse = "Trashi Yangtse"
    Trongsa = "Trongsa"
    Tsirang = "Tsirang"
    WangduePhodrang = "Wangdue Phodrang"
    Zhemgang = "Zhemgang"


class BTCid4G(ExtractionBase):
    doc_type: Literal["BT_CID_4G"] = "BT_CID_4G"
    cid_no: str = Field(pattern=r"^[0-9]{11}$")
    full_name: str = Field(min_length=1)
    dob: FlexibleDate
    sex: FlexibleSex | None = None
    issue_date: FlexibleDate
    expiry_date: FlexibleDate
    dzongkhag: Dzongkhag
    village: str | None = Field(default=None, max_length=100)
    mrz_line1: str | None = None
    mrz_line2: str | None = None

    @field_validator("dob")
    @classmethod
    def _dob_age_band(cls, v: date) -> date:
        age = (date.today() - v).days / 365.25
        if not (0 <= age <= 120):
            raise ValueError("dob age out of range 0-120")
        return v

    @model_validator(mode="after")
    def _date_rules(self) -> "BTCid4G":
        if self.issue_date > date.today():
            raise ValueError("issue_date must be <= today")
        if self.expiry_date <= self.issue_date:
            raise ValueError("expiry_date must be after issue_date")
        return self

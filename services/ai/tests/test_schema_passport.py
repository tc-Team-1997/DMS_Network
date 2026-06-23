import pytest
from pydantic import ValidationError

from zordms_ai.schemas.passport import BTPassport


def _valid() -> dict:
    return {
        "doc_type": "BT_PASSPORT",
        "passport_no": "A1234567",
        "surname": "Dorji",
        "given_names": "Karma",
        "nationality": "BTN",
        "dob": "1985-09-01",
        "issue_date": "2024-01-01",
        "expiry_date": "2034-01-01",
        "mrz_line1": "P<BTNDORJI<<KARMA<<<<<<<<<<<<<<<<<<<<<<<<<<<",
        "confidence": 0.93,
    }


def test_accepts_valid_passport():
    p = BTPassport(**_valid())
    assert p.passport_no == "A1234567"
    assert p.review_flag is False


def test_rejects_bad_passport_no():
    with pytest.raises(ValidationError):
        BTPassport(**(_valid() | {"passport_no": "1234567A"}))


def test_defaults_nationality_btn():
    data = _valid()
    del data["nationality"]
    assert BTPassport(**data).nationality == "BTN"

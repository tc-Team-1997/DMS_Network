"""Tests for BTPassport schema — including date cross-validation (F-05)."""
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


# --- Date cross-validation tests (F-05) ---

def test_rejects_expiry_before_issue():
    """expiry_date must be strictly after issue_date.
    Use a past issue_date so the 'issue_date must be <= today' check does not fire first."""
    bad = _valid() | {"issue_date": "2023-01-01", "expiry_date": "2022-01-01"}
    with pytest.raises(ValidationError, match="expiry_date must be after issue_date"):
        BTPassport(**bad)


def test_rejects_expiry_equal_to_issue():
    """expiry_date == issue_date should also fail."""
    bad = _valid() | {"issue_date": "2024-01-01", "expiry_date": "2024-01-01"}
    with pytest.raises(ValidationError, match="expiry_date must be after issue_date"):
        BTPassport(**bad)


def test_rejects_future_issue_date():
    """issue_date must be <= today."""
    bad = _valid() | {"issue_date": "2999-01-01", "expiry_date": "3000-01-01"}
    with pytest.raises(ValidationError, match="issue_date must be <= today"):
        BTPassport(**bad)

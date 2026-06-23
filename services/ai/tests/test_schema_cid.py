from datetime import date

import pytest
from pydantic import ValidationError

from zordms_ai.schemas.cid import BTCid4G


def _valid() -> dict:
    return {
        "doc_type": "BT_CID_4G",
        "cid_no": "10112345678",
        "full_name": "Sonam Wangchuk",
        "dob": "1990-04-12",
        "sex": "M",
        "issue_date": "2025-01-01",
        "expiry_date": "2035-01-01",
        "dzongkhag": "Thimphu",
        "confidence": 0.95,
    }


def test_accepts_valid_cid():
    cid = BTCid4G(**_valid())
    assert cid.cid_no == "10112345678"
    assert cid.dob == date(1990, 4, 12)
    assert cid.review_flag is False


def test_rejects_cid_with_wrong_digit_count():
    bad = _valid() | {"cid_no": "123"}
    with pytest.raises(ValidationError):
        BTCid4G(**bad)


def test_rejects_expiry_before_issue():
    bad = _valid() | {"issue_date": "2030-01-01", "expiry_date": "2029-01-01"}
    with pytest.raises(ValidationError):
        BTCid4G(**bad)


def test_rejects_unknown_dzongkhag():
    bad = _valid() | {"dzongkhag": "Atlantis"}
    with pytest.raises(ValidationError):
        BTCid4G(**bad)


def test_rejects_future_issue_date():
    bad = _valid() | {"issue_date": "2999-01-01", "expiry_date": "3000-01-01"}
    with pytest.raises(ValidationError):
        BTCid4G(**bad)


def test_low_confidence_sets_review_flag():
    cid = BTCid4G(**(_valid() | {"confidence": 0.7}))
    assert cid.review_flag is True

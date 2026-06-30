import pytest
from pydantic import ValidationError

from zordms_ai.schemas.citizenship import BTCitizenship
from zordms_ai.schemas.registry import schema_for


def _valid() -> dict:
    return {
        "doc_type": "BT_CITIZENSHIP",
        "cid_no": "11301005678",
        "full_name": "Dechen Zangmo",
        "sex": "F",
        "dzongkhag": "Thimphu",
        "gewog": "Kawang",
        "issue_date": "2020-01-10",
        "confidence": 0.92,
    }


def test_registry_resolves_citizenship():
    assert schema_for("BT_CITIZENSHIP") is BTCitizenship


def test_accepts_full_record():
    doc = BTCitizenship(**_valid())
    assert doc.doc_type == "BT_CITIZENSHIP"
    assert doc.cid_no == "11301005678"
    assert doc.dzongkhag.value == "Thimphu"
    assert doc.review_flag is False  # confidence >= 0.85


def test_accepts_minimal_record_optionals_null():
    # Only the two regulatory-mandatory fields present; optionals stay null
    # rather than forcing the whole document into review.
    doc = BTCitizenship(doc_type="BT_CITIZENSHIP", cid_no="10201009912", full_name="Phurba Namgyel", confidence=0.9)
    assert doc.sex is None
    assert doc.issue_date is None
    assert doc.dzongkhag is None


def test_requires_cid_no_and_full_name():
    with pytest.raises(ValidationError):
        BTCitizenship(doc_type="BT_CITIZENSHIP", full_name="No CID", confidence=0.9)
    with pytest.raises(ValidationError):
        BTCitizenship(doc_type="BT_CITIZENSHIP", cid_no="11301005678", confidence=0.9)


def test_rejects_future_issue_date():
    with pytest.raises(ValidationError):
        BTCitizenship(**(_valid() | {"issue_date": "2999-01-01"}))


def test_low_confidence_sets_review_flag():
    doc = BTCitizenship(**(_valid() | {"confidence": 0.5}))
    assert doc.review_flag is True


def test_coerces_real_world_date_and_sex_formats():
    """VLMs emit 'Male' and DD/MM/YYYY — these must be coerced, not rejected."""
    doc = BTCitizenship(
        doc_type="BT_CITIZENSHIP",
        cid_no="10309000571",
        full_name="Hari Krishna Chimorya",
        dob="25/03/1983",
        sex="Male",
        confidence=1.0,
    )
    assert doc.dob.year == 1983 and doc.dob.month == 3 and doc.dob.day == 25
    assert doc.sex.value == "M"


def test_coercion_helpers_pass_through_unparseable():
    from zordms_ai.schemas.base import normalize_sex, parse_flexible_date

    # ISO and canonical still work
    assert str(parse_flexible_date("2020-01-10")) == "2020-01-10"
    assert normalize_sex("F").value == "F"
    # blanks → None
    assert parse_flexible_date("") is None
    assert normalize_sex("") is None
    # unrecognised passes through unchanged (pydantic will then raise → review)
    assert parse_flexible_date("not-a-date") == "not-a-date"

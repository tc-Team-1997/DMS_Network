import pytest
from pydantic import ValidationError

from zordms_ai.schemas.loan import BOBLoanApplication
from zordms_ai.schemas.registry import DOC_SCHEMAS, schema_for


def _valid() -> dict:
    return {
        "doc_type": "BOB_LOAN_APPLICATION",
        "application_no": "LN2026001",
        "applicant_cid": "10112345678",
        "applicant_name": "Tashi Pem",
        "loan_type": "HOME",
        "loan_amount": 2500000.0,
        "branch_code": "THI001",
        "submission_date": "2026-06-01",
        "confidence": 0.90,
    }


def test_accepts_valid_loan():
    loan = BOBLoanApplication(**_valid())
    assert loan.loan_type.value == "HOME"


def test_rejects_unknown_loan_type():
    with pytest.raises(ValidationError):
        BOBLoanApplication(**(_valid() | {"loan_type": "BOAT"}))


def test_registry_resolves_known_types():
    assert set(DOC_SCHEMAS) == {"BT_CID_4G", "BT_CITIZENSHIP", "BT_PASSPORT", "BOB_LOAN_APPLICATION"}
    assert schema_for("BOB_LOAN_APPLICATION") is BOBLoanApplication


def test_registry_raises_on_unknown():
    with pytest.raises(KeyError):
        schema_for("MARTIAN_VISA")

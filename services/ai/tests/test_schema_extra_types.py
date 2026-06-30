"""Schemas added to close the 'no extraction schema' gap for classifiable
doc_types: foreign passport, Indian KYC, AML reports, account form, generic."""

import pytest
from pydantic import ValidationError

from zordms_ai.schemas.account import BobAccountForm
from zordms_ai.schemas.aml import Ctr, SarReport
from zordms_ai.schemas.generic import GenericDocument
from zordms_ai.schemas.kyc_extra import ForeignPassport, InAadhaar, InPan
from zordms_ai.schemas.registry import DOC_SCHEMAS, schema_for


def test_registry_resolves_all_new_types():
    for code, cls in {
        "FOREIGN_PASSPORT": ForeignPassport,
        "IN_PAN": InPan,
        "IN_AADHAAR": InAadhaar,
        "BOB_ACCOUNT_FORM": BobAccountForm,
        "SAR_REPORT": SarReport,
        "CTR": Ctr,
    }.items():
        assert code in DOC_SCHEMAS
        assert schema_for(code) is cls


def test_foreign_passport_requires_nationality():
    ok = ForeignPassport(doc_type="FOREIGN_PASSPORT", passport_no="X1234567", full_name="Jane Doe", nationality="IND", confidence=0.9)
    assert ok.nationality == "IND"
    with pytest.raises(ValidationError):
        ForeignPassport(doc_type="FOREIGN_PASSPORT", passport_no="X1", full_name="No Nat", confidence=0.9)  # missing nationality


def test_in_pan_format():
    ok = InPan(doc_type="IN_PAN", pan_no="ABCDE1234F", name="Ravi Kumar", confidence=0.9)
    assert ok.pan_no == "ABCDE1234F"
    with pytest.raises(ValidationError):
        InPan(doc_type="IN_PAN", pan_no="BADPAN", name="x", confidence=0.9)


def test_in_aadhaar_12_digits():
    ok = InAadhaar(doc_type="IN_AADHAAR", aadhaar_no="123456789012", name="Asha", confidence=0.9)
    assert ok.aadhaar_no == "123456789012"
    with pytest.raises(ValidationError):
        InAadhaar(doc_type="IN_AADHAAR", aadhaar_no="123", name="x", confidence=0.9)


def test_sar_report_mandatory_fields():
    ok = SarReport(doc_type="SAR_REPORT", subject="Acme Ltd", amount=500000.0, report_date="2026-05-01", confidence=0.9)
    assert ok.subject == "Acme Ltd"
    with pytest.raises(ValidationError):
        SarReport(doc_type="SAR_REPORT", subject="No amount", report_date="2026-05-01", confidence=0.9)


def test_ctr_mandatory_fields():
    ok = Ctr(doc_type="CTR", amount=1200000.0, transaction_date="2026-04-20", confidence=0.9)
    assert ok.amount == 1200000.0
    with pytest.raises(ValidationError):
        Ctr(doc_type="CTR", transaction_date="2026-04-20", confidence=0.9)  # missing amount


def test_account_form_rejects_future_open_date():
    ok = BobAccountForm(doc_type="BOB_ACCOUNT_FORM", account_no="0123456789", customer_name="Tashi", confidence=0.9)
    assert ok.account_no == "0123456789"
    with pytest.raises(ValidationError):
        BobAccountForm(doc_type="BOB_ACCOUNT_FORM", account_no="1", customer_name="x", date_opened="2999-01-01", confidence=0.9)


def test_generic_document_minimal_and_freeform_fields():
    g = GenericDocument(doc_type="GENERAL_LETTER", title="Notice", fields={"cc": "Branch Ops"}, confidence=0.9)
    assert g.title == "Notice"
    assert g.fields["cc"] == "Branch Ops"
    # Everything but confidence is optional → a bare doc still validates.
    bare = GenericDocument(confidence=0.5)
    assert bare.doc_type == "GENERIC"
    assert bare.review_flag is True  # low confidence

from __future__ import annotations

from zordms_ai.schemas.account import BobAccountForm
from zordms_ai.schemas.aml import Ctr, SarReport
from zordms_ai.schemas.base import ExtractionBase
from zordms_ai.schemas.cid import BTCid4G
from zordms_ai.schemas.citizenship import BTCitizenship
from zordms_ai.schemas.kyc_extra import ForeignPassport, InAadhaar, InPan
from zordms_ai.schemas.loan import BOBLoanApplication
from zordms_ai.schemas.passport import BTPassport

DOC_SCHEMAS: dict[str, type[ExtractionBase]] = {
    # KYC / identity
    "BT_CID_4G": BTCid4G,
    "BT_CITIZENSHIP": BTCitizenship,
    "BT_PASSPORT": BTPassport,
    "FOREIGN_PASSPORT": ForeignPassport,
    "IN_PAN": InPan,
    "IN_AADHAAR": InAadhaar,
    # Account / loan
    "BOB_ACCOUNT_FORM": BobAccountForm,
    "BOB_LOAN_APPLICATION": BOBLoanApplication,
    # AML / compliance reports
    "SAR_REPORT": SarReport,
    "CTR": Ctr,
}


def schema_for(doc_type: str) -> type[ExtractionBase]:
    return DOC_SCHEMAS[doc_type]

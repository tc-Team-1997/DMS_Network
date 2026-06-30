from __future__ import annotations

from zordms_ai.schemas.base import ExtractionBase
from zordms_ai.schemas.cid import BTCid4G
from zordms_ai.schemas.citizenship import BTCitizenship
from zordms_ai.schemas.loan import BOBLoanApplication
from zordms_ai.schemas.passport import BTPassport

DOC_SCHEMAS: dict[str, type[ExtractionBase]] = {
    "BT_CID_4G": BTCid4G,
    "BT_CITIZENSHIP": BTCitizenship,
    "BT_PASSPORT": BTPassport,
    "BOB_LOAN_APPLICATION": BOBLoanApplication,
}


def schema_for(doc_type: str) -> type[ExtractionBase]:
    return DOC_SCHEMAS[doc_type]

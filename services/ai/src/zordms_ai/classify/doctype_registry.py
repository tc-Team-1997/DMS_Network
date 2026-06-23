from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import IntEnum


class SignalType(IntEnum):
    MRZ = 1
    ID_REGEX = 2
    LOGO = 3
    HEADER = 4
    LAYOUT = 5
    LANGUAGE = 6
    FALLBACK = 7


@dataclass(frozen=True)
class DocTypeEntry:
    code: str
    description: str
    jurisdiction: str
    issuer: str
    regex_signals: list[tuple[SignalType, re.Pattern]] = field(default_factory=list)
    keyword_signals: list[tuple[SignalType, str]] = field(default_factory=list)


def _rx(pattern: str) -> re.Pattern:
    return re.compile(pattern)


DOCTYPE_REGISTRY: dict[str, DocTypeEntry] = {
    "BT_CID_4G": DocTypeEntry(
        "BT_CID_4G", "Bhutan CID Card (4G, 2025+)", "BT", "DCRC",
        regex_signals=[(SignalType.ID_REGEX, _rx(r"\b[0-9]{11}\b"))],
        keyword_signals=[(SignalType.HEADER, "Kingdom of Bhutan"), (SignalType.LANGUAGE, "Citizenship Identity")],
    ),
    "BT_CITIZENSHIP": DocTypeEntry(
        "BT_CITIZENSHIP", "Bhutan Citizenship Certificate", "BT", "DCRC",
        keyword_signals=[(SignalType.HEADER, "Citizenship Certificate")],
    ),
    "BT_PASSPORT": DocTypeEntry(
        "BT_PASSPORT", "Bhutan Passport (biometric)", "BT", "DoI / MoFA",
        regex_signals=[(SignalType.MRZ, _rx(r"P<BTN"))],
        keyword_signals=[(SignalType.HEADER, "Passport")],
    ),
    "FOREIGN_PASSPORT": DocTypeEntry(
        "FOREIGN_PASSPORT", "Non-Bhutan passport", "INT", "Foreign state",
        regex_signals=[(SignalType.MRZ, _rx(r"P<(?!BTN)[A-Z]{3}"))],
    ),
    "IN_PAN": DocTypeEntry(
        "IN_PAN", "Indian PAN Card", "IN", "CBDT / NSDL",
        regex_signals=[(SignalType.ID_REGEX, _rx(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b"))],
        keyword_signals=[(SignalType.HEADER, "Income Tax Department")],
    ),
    "IN_AADHAAR": DocTypeEntry(
        "IN_AADHAAR", "Indian Aadhaar Card", "IN", "UIDAI",
        regex_signals=[(SignalType.ID_REGEX, _rx(r"\b[0-9]{4} [0-9]{4} [0-9]{4}\b"))],
        keyword_signals=[(SignalType.HEADER, "Unique Identification")],
    ),
    "BOB_ACCOUNT_FORM": DocTypeEntry(
        "BOB_ACCOUNT_FORM", "BoB Account Opening Form", "BT", "Bank of Bhutan",
        keyword_signals=[(SignalType.HEADER, "Account Opening Form")],
    ),
    "BOB_LOAN_APPLICATION": DocTypeEntry(
        "BOB_LOAN_APPLICATION", "BoB Loan Application", "BT", "Bank of Bhutan",
        keyword_signals=[(SignalType.HEADER, "Loan Application")],
    ),
    "BOB_INVOICE": DocTypeEntry(
        "BOB_INVOICE", "BoB-related Invoice", "BT", "Vendor",
        regex_signals=[(SignalType.ID_REGEX, _rx(r"\bTPN[:\s]*[0-9]{9}\b"))],
        keyword_signals=[(SignalType.HEADER, "TAX INVOICE")],
    ),
    "PURCHASE_ORDER": DocTypeEntry(
        "PURCHASE_ORDER", "Bank Purchase Order", "BT", "Bank of Bhutan",
        keyword_signals=[(SignalType.HEADER, "Purchase Order No.")],
    ),
    "SAR_REPORT": DocTypeEntry(
        "SAR_REPORT", "Suspicious Activity Report", "BT", "FIU / FID",
        keyword_signals=[(SignalType.HEADER, "Suspicious Activity")],
    ),
    "CTR": DocTypeEntry(
        "CTR", "Cash Transaction Report", "BT", "RMA / FIU",
        keyword_signals=[(SignalType.HEADER, "Cash Transaction")],
    ),
    "EMPLOYMENT_CONTRACT": DocTypeEntry(
        "EMPLOYMENT_CONTRACT", "Staff Employment Contract", "BT", "Bank of Bhutan HR",
        keyword_signals=[(SignalType.HEADER, "Employment Contract")],
    ),
    "BOARD_RESOLUTION": DocTypeEntry(
        "BOARD_RESOLUTION", "Board Resolution", "BT", "BoB Board Sec.",
        keyword_signals=[(SignalType.HEADER, "Board Resolution No.")],
    ),
    "RMA_INSPECTION": DocTypeEntry(
        "RMA_INSPECTION", "RMA Inspection Report", "BT", "RMA",
        keyword_signals=[(SignalType.HEADER, "Inspection Report")],
    ),
    "RAA_AUDIT_REPORT": DocTypeEntry(
        "RAA_AUDIT_REPORT", "RAA Audit Report", "BT", "RAA",
        keyword_signals=[(SignalType.HEADER, "Audit Report")],
    ),
    "GENERAL_LETTER": DocTypeEntry(
        "GENERAL_LETTER", "General Correspondence", "ANY", "Various",
        keyword_signals=[(SignalType.FALLBACK, "letter")],
    ),
    "UNKNOWN": DocTypeEntry(
        "UNKNOWN", "Unclassified / Unreadable", "ANY", "-",
    ),
}


def all_doc_type_codes() -> list[str]:
    return list(DOCTYPE_REGISTRY)

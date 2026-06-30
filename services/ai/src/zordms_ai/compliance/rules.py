"""Rule-based regulatory compliance validation (§5.7).

Distinct from core's generic field validation (data-type rules) and core's
compliance *scorecard* (framework matrix): this evaluates a SINGLE document's
extracted data against deterministic regulatory rules and returns a per-document
verdict. No model required — pure rules — so it runs offline and is fully tested.

Frameworks: RMA Prudential (KYC completeness, retention) and FATF/AML
(identity validity, suspicious-activity report capture).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Optional

KYC_DOC_TYPES = {"BT_CID_4G", "BT_CITIZENSHIP", "BT_PASSPORT", "FOREIGN_PASSPORT", "IN_PAN", "IN_AADHAAR"}
AML_DOC_TYPES = {"SAR_REPORT", "CTR"}

# Mandatory regulatory fields per doc type (KYC identity set / AML report set).
MANDATORY_FIELDS: dict[str, list[str]] = {
    "BT_CID_4G": ["cid_no", "full_name", "date_of_birth"],
    "BT_CITIZENSHIP": ["cid_no", "full_name"],
    "BT_PASSPORT": ["passport_no", "full_name", "date_of_expiry"],
    "FOREIGN_PASSPORT": ["passport_no", "full_name", "date_of_expiry"],
    "SAR_REPORT": ["subject", "amount", "report_date"],
    "CTR": ["amount", "transaction_date"],
}

# Fields that, if present, carry an expiry date to check against "today".
EXPIRY_FIELDS = ["date_of_expiry", "expiry", "expiry_date", "valid_until"]

# Doc types that carry a defined retention class (used for the retention check).
RETENTION_KNOWN = KYC_DOC_TYPES | AML_DOC_TYPES | {
    "BOB_LOAN_APPLICATION", "BOB_ACCOUNT_FORM", "LOAN_DISBURSEMENT", "RMA_INSPECTION",
    "RAA_AUDIT_REPORT", "EMPLOYMENT_CONTRACT", "BOARD_RESOLUTION", "REGULATORY_RETURN",
    "LAND_DEED", "LEASE_CONTRACT",
}


@dataclass
class ComplianceCheck:
    rule: str
    framework: str
    severity: str  # "error" | "warning"
    passed: bool
    message: str


def _blank(v: Any) -> bool:
    return v is None or str(v).strip() == ""


def _parse_date(v: Any) -> Optional[date]:
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        return None


def validate_compliance(
    doc_type: str,
    data: dict[str, Any],
    *,
    as_of: Optional[date] = None,
) -> dict[str, Any]:
    """Evaluate *data* for *doc_type* against the regulatory rule set."""
    today = as_of or date.today()
    checks: list[ComplianceCheck] = []

    # 1. Mandatory regulatory fields (RMA KYC / FATF AML report set).
    framework = "FATF/AML" if doc_type in AML_DOC_TYPES else "RMA Prudential"
    for field in MANDATORY_FIELDS.get(doc_type, []):
        present = not _blank(data.get(field))
        checks.append(ComplianceCheck(
            rule=f"mandatory:{field}", framework=framework, severity="error", passed=present,
            message=f"required field '{field}' present" if present else f"missing required field '{field}'",
        ))

    # 2. Identity validity — expiry must not be in the past (FATF KYC).
    if doc_type in KYC_DOC_TYPES:
        expiry_val = next((data[f] for f in EXPIRY_FIELDS if f in data and not _blank(data[f])), None)
        if expiry_val is not None:
            exp = _parse_date(expiry_val)
            if exp is None:
                checks.append(ComplianceCheck("identity:expiry_parse", "FATF/AML", "warning", False, f"could not parse expiry '{expiry_val}'"))
            else:
                ok = exp >= today
                checks.append(ComplianceCheck(
                    "identity:not_expired", "FATF/AML", "error", ok,
                    message="identity document is valid" if ok else f"identity document expired on {exp.isoformat()}",
                ))
        else:
            checks.append(ComplianceCheck("identity:expiry_present", "FATF/AML", "warning", False, "no expiry date on identity document"))

    # 3. Retention classification (RMA retention) — every record must classify.
    classified = doc_type in RETENTION_KNOWN
    checks.append(ComplianceCheck(
        "retention:classified", "RMA Prudential", "warning", classified,
        message="document has a defined retention class" if classified else f"no retention class for doc type '{doc_type}'",
    ))

    total = len(checks)
    passed = sum(1 for c in checks if c.passed)
    errors = [c for c in checks if not c.passed and c.severity == "error"]
    warnings = [c for c in checks if not c.passed and c.severity == "warning"]
    return {
        "doc_type": doc_type,
        "compliant": len(errors) == 0,
        "score": round(passed / total, 3) if total else 1.0,
        "errors": len(errors),
        "warnings": len(warnings),
        "checks": [c.__dict__ for c in checks],
    }

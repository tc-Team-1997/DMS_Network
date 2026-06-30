"""§5.7 Compliance validation — rule engine + endpoint."""
import io
from datetime import date

from fastapi.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.compliance.rules import validate_compliance
from zordms_ai.settings import Settings


# ── Rule engine (no auth / no model) ─────────────────────────────────────────

def test_valid_cid_is_compliant():
    r = validate_compliance(
        "BT_CID_4G",
        {"cid_no": "11504000231", "full_name": "Dorji W", "date_of_birth": "1990-01-01", "date_of_expiry": "2099-12-31"},
    )
    assert r["compliant"] is True
    assert r["errors"] == 0


def test_expired_identity_fails():
    r = validate_compliance(
        "BT_PASSPORT",
        {"passport_no": "P1", "full_name": "X", "date_of_expiry": "2000-01-01"},
        as_of=date(2026, 6, 30),
    )
    assert r["compliant"] is False
    assert any(c["rule"] == "identity:not_expired" and not c["passed"] for c in r["checks"])


def test_missing_mandatory_field_fails():
    r = validate_compliance("BT_CID_4G", {"cid_no": "1", "date_of_expiry": "2099-01-01"})
    assert r["compliant"] is False
    assert any(c["rule"] == "mandatory:full_name" and not c["passed"] for c in r["checks"])


def test_aml_report_completeness():
    bad = validate_compliance("SAR_REPORT", {"subject": "ACME"})  # missing amount + report_date
    assert bad["compliant"] is False
    assert bad["errors"] >= 2
    good = validate_compliance("SAR_REPORT", {"subject": "ACME", "amount": "50000", "report_date": "2026-06-01"})
    assert good["compliant"] is True


def test_unknown_doc_type_warns_but_is_compliant():
    r = validate_compliance("MYSTERY_DOC", {})
    # no error-severity failures (only a retention warning) → compliant
    assert r["compliant"] is True
    assert r["warnings"] >= 1
    assert any(c["rule"] == "retention:classified" and not c["passed"] for c in r["checks"])


def test_missing_expiry_is_warning_not_error():
    r = validate_compliance("BT_CID_4G", {"cid_no": "1", "full_name": "X", "date_of_birth": "1990-01-01"})
    # mandatory fields satisfied; only an expiry-present warning → still compliant
    assert r["compliant"] is True
    assert any(c["rule"] == "identity:expiry_present" and not c["passed"] and c["severity"] == "warning" for c in r["checks"])


# ── Endpoint (auth) ──────────────────────────────────────────────────────────

def _app():
    return create_app(Settings(database_url="sqlite+pysqlite:///:memory:", jwt_secret=TEST_JWT_SECRET))


def test_endpoint_requires_auth():
    client = TestClient(_app())
    res = client.post("/idp/compliance/validate", json={"doc_type": "BT_CID_4G", "data": {}})
    assert res.status_code == 401


def test_endpoint_returns_verdict():
    client = TestClient(_app())
    res = client.post(
        "/idp/compliance/validate",
        json={"doc_type": "BT_PASSPORT", "data": {"passport_no": "P1", "full_name": "X", "date_of_expiry": "2000-01-01"}, "as_of": "2026-06-30"},
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["doc_type"] == "BT_PASSPORT"
    assert body["compliant"] is False
    assert "checks" in body and len(body["checks"]) > 0

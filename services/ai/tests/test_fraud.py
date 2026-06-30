"""§5.5 Fraud / AML — rule-based screening + endpoint."""
from fastapi.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.fraud.rules import screen
from zordms_ai.settings import Settings


# ── Rule engine ──────────────────────────────────────────────────────────────

def test_clean_record_has_no_flags():
    r = screen({"amount": 5000, "subject": "Dorji"})
    assert r["flagged"] is False
    assert r["risk_band"] == "clear"
    assert r["risk_score"] == 0


def test_ctr_threshold_flagged():
    r = screen({"amount": 1_500_000})
    rules = {f["rule"] for f in r["flags"]}
    assert "ctr_threshold" in rules
    assert r["flagged"] is True


def test_structuring_just_under_threshold():
    r = screen({"amount": 999_000})  # 0.9*1e6 <= 999000 < 1e6
    rules = {f["rule"] for f in r["flags"]}
    assert "possible_structuring" in rules
    assert r["risk_band"] in ("high", "medium")


def test_watchlist_hit_is_critical():
    r = screen({"amount": 100, "subject": "ACME Ltd"}, watchlist=["acme ltd"])
    assert r["risk_band"] == "critical"
    assert any(f["rule"] == "watchlist_hit" and f["severity"] == "critical" for f in r["flags"])


def test_high_risk_country_and_velocity():
    r = screen({"amount": 200, "country": "KP", "transaction_count": 12})
    rules = {f["rule"] for f in r["flags"]}
    assert "high_risk_country" in rules
    assert "high_velocity" in rules


def test_round_amount_low_severity():
    r = screen({"amount": 800_000})  # round, >=500k, under threshold
    rules = {f["rule"] for f in r["flags"]}
    assert "round_amount" in rules


# ── Endpoint ─────────────────────────────────────────────────────────────────

def _app():
    return create_app(Settings(database_url="sqlite+pysqlite:///:memory:", jwt_secret=TEST_JWT_SECRET))


def test_endpoint_requires_auth():
    res = TestClient(_app()).post("/idp/fraud-check", json={"record": {"amount": 1}})
    assert res.status_code == 401


def test_endpoint_screens_and_uses_watchlist():
    res = TestClient(_app()).post(
        "/idp/fraud-check",
        json={"record": {"amount": 999000, "subject": "Bad Actor"}, "watchlist": ["bad actor"]},
        headers={"Authorization": f"Bearer {make_token()}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["flagged"] is True
    assert body["risk_band"] == "critical"  # watchlist hit dominates
    rules = {f["rule"] for f in body["flags"]}
    assert {"possible_structuring", "watchlist_hit"} <= rules

"""Tests for the multi-channel notification layer (BRD #24).

Provider tests exercise the no-op paths (no env creds → ok=False, graceful).
Router tests hit /health and /preferences with a faked session.

Wave C: SMS and WhatsApp providers are now CC6 TwilioSms / NoopSms registered
in the integration provider registry. The old notify/sms.py and
notify/whatsapp.py shims have been deleted (approach a — no bifurcation).
"""
from __future__ import annotations

import asyncio
import json
import os

import pytest

# Env vars (API_KEY, DATABASE_URL, no-SMTP/Twilio) are set by tests/conftest.py
# before any module is imported. Nothing to do here.

# ---------------------------------------------------------------------------
# Provider unit tests — no-op paths
# ---------------------------------------------------------------------------


def test_email_provider_no_op():
    """EmailProvider (notify package) returns ok=False when SMTP_HOST is not set."""
    from app.services.notify.email import EmailProvider

    provider = EmailProvider()
    assert not provider.configured

    result = asyncio.run(
        provider.send(to="test@example.com", subject="Test", body="Hello")
    )
    assert result["ok"] is False
    assert "error" in result


def test_twilio_sms_no_op():
    """TwilioSms CC6 provider returns ok=False when TWILIO_ACCOUNT_SID is not set."""
    from app.services.integrations.providers.local.twilio_sms import TwilioSms

    provider = TwilioSms()
    assert not provider.configured

    result = provider.send(to="+1234567890", body="Hello")
    assert result.ok is False
    assert result.detail  # error detail populated


def test_noop_sms_always_ok():
    """NoopSms CC6 provider always returns ok=True (log-only, no network call)."""
    from app.services.integrations.providers.local.noop_sms import NoopSms

    provider = NoopSms()
    result = provider.send(to="+97517123456", body="Test message")
    assert result.ok is True
    assert result.message_id == "noop"


def test_send_no_address():
    """notify.send returns ok=False per channel when no address is available."""
    from app.services import notify as notify_svc

    results = asyncio.run(
        notify_svc.send(
            user_id="no_such_user",
            event_type="test",
            subject="S",
            body="B",
            channels=["email"],
            db=None,
            to_override=None,
        )
    )
    assert "email" in results
    assert results["email"]["ok"] is False


def test_send_with_address_no_creds():
    """notify.send with an explicit to_override but no SMTP → ok=False gracefully."""
    from app.services import notify as notify_svc

    results = asyncio.run(
        notify_svc.send(
            user_id="testuser",
            event_type="doc_expiry",
            subject="[WARNING] Expiring soon",
            body="Your document expires in 3 days.",
            channels=["email"],
            db=None,
            to_override={"email": "testuser@example.com"},
        )
    )
    assert "email" in results
    assert results["email"]["ok"] is False  # no SMTP_HOST → no-op
    assert "error" in results["email"]


def test_provider_status_no_creds():
    """provider_status() returns configured=False for all channels when no env vars set."""
    from app.services import notify as notify_svc

    # Re-instantiate providers to pick up stripped env
    from app.services.notify.email import EmailProvider
    notify_svc._providers = {
        "email": EmailProvider(),
        # SMS and WhatsApp are now CC6 providers — not in _providers dict.
        # provider_status() only reports on what is in _providers.
    }

    status = notify_svc.provider_status()
    assert "email" in status
    assert status["email"]["configured"] is False


def test_unknown_channel():
    """notify.send with an unknown channel name returns an error entry."""
    from app.services import notify as notify_svc

    results = asyncio.run(
        notify_svc.send(
            user_id="u1",
            event_type="test",
            subject="S",
            body="B",
            channels=["carrier_pigeon"],
            db=None,
            to_override={"carrier_pigeon": "somewhere"},
        )
    )
    assert results["carrier_pigeon"]["ok"] is False


# ---------------------------------------------------------------------------
# Router integration tests
# ---------------------------------------------------------------------------

from fastapi.testclient import TestClient  # noqa: E402

# Import app after env vars are set
from app.main import app  # noqa: E402

H = {"X-API-Key": "test-key"}
client = TestClient(app)


def test_notify_health():
    """GET /api/v1/notify/health returns provider status without creds leak."""
    r = client.get("/api/v1/notify/health", headers=H)
    assert r.status_code == 200
    data = r.json()
    assert "email" in data
    # No auth tokens or passwords should appear in the response
    body_str = r.text
    for secret_key in ("SMTP_PASS", "TWILIO_AUTH_TOKEN", "password", "token", "secret"):
        assert secret_key not in body_str


def test_notify_health_requires_api_key():
    """GET /api/v1/notify/health is rejected without API key."""
    r = client.get("/api/v1/notify/health")
    assert r.status_code == 401


def test_notify_preferences_get_default():
    """GET /api/v1/notify/preferences returns default channels for a fresh user."""
    r = client.get("/api/v1/notify/preferences", headers=H)
    assert r.status_code == 200
    data = r.json()
    assert "user_sub" in data
    assert "channels" in data
    assert isinstance(data["channels"], list)
    assert len(data["channels"]) >= 1


def test_notify_preferences_set_and_get():
    """POST /api/v1/notify/preferences persists channels; GET reflects them."""
    payload = {
        "channels": ["email", "sms"],
        "email": "api-key@example.com",
        "phone": "+97712345678",
    }
    r = client.post("/api/v1/notify/preferences", headers=H, json=payload)
    assert r.status_code == 200
    data = r.json()
    assert set(data["channels"]) == {"email", "sms"}
    assert data["email"] == "api-key@example.com"
    assert data["phone"] == "+97712345678"

    # Read back
    r2 = client.get("/api/v1/notify/preferences", headers=H)
    assert r2.status_code == 200
    data2 = r2.json()
    assert set(data2["channels"]) == {"email", "sms"}


def test_notify_preferences_invalid_channel():
    """POST /api/v1/notify/preferences rejects unknown channel names."""
    r = client.post(
        "/api/v1/notify/preferences",
        headers=H,
        json={"channels": ["fax"]},
    )
    assert r.status_code == 422


def test_notify_test_endpoint_no_creds():
    """POST /api/v1/notify/test returns a result (ok=False) when no creds configured."""
    payload = {"channel": "email", "to": "test@example.com", "message": "Hello from pytest"}
    r = client.post("/api/v1/notify/test", headers=H, json=payload)
    assert r.status_code == 200
    data = r.json()
    assert "ok" in data
    # Should be False since no SMTP configured
    assert data["ok"] is False


def test_alert_post_fires_notify():
    """POST /api/v1/alerts creates a record; notify is best-effort (no creds → no error)."""
    payload = {
        "user_id": "pytest-user",
        "level": "warning",
        "title": "Document expiring",
        "message": "Passport expires in 3 days.",
    }
    r = client.post("/api/v1/alerts", headers=H, json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["level"] == "warning"
    assert data["title"] == "Document expiring"
    assert "id" in data

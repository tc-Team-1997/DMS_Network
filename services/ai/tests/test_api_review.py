"""Tests for the /idp/review/* endpoints — auth-aware."""
from datetime import datetime

import jwt
import pytest
from fastapi.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.review.service import enqueue
from zordms_ai.routing.confidence import route_by_confidence
from zordms_ai.settings import Settings


def _make_settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret=TEST_JWT_SECRET,
    )


def _auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token()}"}


def _client_with_item():
    app = create_app(_make_settings())
    with app.state.session_factory() as s:
        item = enqueue(
            s, doc_id="d1", doc_type="BT_CID_4G", confidence=0.60,
            decision=route_by_confidence(0.60), payload_json="{}",
            now=datetime(2026, 6, 23, 10, 0, 0),
        )
        item_id = item.id
    return TestClient(app), item_id


# --- Auth enforcement tests (F-01) ---

def test_pending_requires_auth():
    client, _ = _client_with_item()
    res = client.get("/idp/review/pending")
    assert res.status_code == 401


def test_claim_requires_auth():
    client, item_id = _client_with_item()
    res = client.post(f"/idp/review/{item_id}/claim", data={"user_id": "X"})
    assert res.status_code == 401


def test_resolve_requires_auth():
    client, item_id = _client_with_item()
    res = client.post(f"/idp/review/{item_id}/resolve", data={"resolution": "OK"})
    assert res.status_code == 401


def test_invalid_token_returns_401():
    client, _ = _client_with_item()
    res = client.get(
        "/idp/review/pending",
        headers={"Authorization": "Bearer this-is-not-a-valid-jwt"},
    )
    assert res.status_code == 401


# --- Functional tests (now with valid auth) ---

def test_list_pending():
    client, _ = _client_with_item()
    res = client.get("/idp/review/pending", headers=_auth())
    assert res.status_code == 200
    rows = res.json()
    assert rows[0]["doc_id"] == "d1"
    assert rows[0]["sla_hours"] == 24


def test_claim_then_resolve():
    client, item_id = _client_with_item()
    c = client.post(
        f"/idp/review/{item_id}/claim",
        data={"user_id": "STAFF9"},
        headers=_auth(),
    )
    assert c.status_code == 200
    assert c.json()["status"] == "CLAIMED"
    r = client.post(
        f"/idp/review/{item_id}/resolve",
        data={"resolution": "APPROVED"},
        headers=_auth(),
    )
    assert r.status_code == 200
    assert r.json()["status"] == "RESOLVED"


def test_double_claim_conflict():
    client, item_id = _client_with_item()
    client.post(
        f"/idp/review/{item_id}/claim",
        data={"user_id": "A"},
        headers=_auth(),
    )
    again = client.post(
        f"/idp/review/{item_id}/claim",
        data={"user_id": "B"},
        headers=_auth(),
    )
    assert again.status_code == 409


def test_resolve_nonexistent_returns_404():
    """Ensure resolve_item returns 404 (not 500) for missing items (F-02)."""
    client, _ = _client_with_item()
    res = client.post(
        "/idp/review/99999/resolve",
        data={"resolution": "APPROVED"},
        headers=_auth(),
    )
    assert res.status_code == 404


def test_claim_nonexistent_returns_404():
    """Ensure claim_item returns 404 (not 409) for missing items (F-02)."""
    client, _ = _client_with_item()
    res = client.post(
        "/idp/review/99999/claim",
        data={"user_id": "STAFF1"},
        headers=_auth(),
    )
    assert res.status_code == 404

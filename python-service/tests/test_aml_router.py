"""Tests for the AML router (GET /aml/matches, POST /aml/matches/bulk-review, GET /aml/stats)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


# ── minimal app fixture ───────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    """Spin up a TestClient against the real app with DB backed by in-memory SQLite."""
    os.environ.setdefault("API_KEY", "test-key")
    os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test_aml.db")

    from app.main import app
    return TestClient(app, raise_server_exceptions=False)


HEADERS = {"X-API-Key": "test-key"}


# ── /aml/stats ────────────────────────────────────────────────────────────────

def test_stats_requires_api_key(client):
    resp = client.get("/api/v1/aml/stats")
    # Missing API key — 401 from require_api_key dependency.
    assert resp.status_code == 401


def test_stats_returns_expected_shape(client):
    """Stats endpoint returns count fields.

    The /api/v1/aml/stats route is now owned by aml_screening_router
    (registered before the legacy aml_router). The response shape reflects
    the new screening-based stats rather than the old match-based fields.
    """
    from app.services.auth import require

    fake_principal = MagicMock()
    fake_principal.sub = "tester"
    fake_principal.tenant = "default"
    fake_principal.has = lambda p: True
    fake_principal.roles = ["doc_admin"]

    from app.main import app
    app.dependency_overrides[require("audit_read")] = lambda: fake_principal

    try:
        resp = client.get("/api/v1/aml/stats", headers=HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        # New shape from aml_screening_router
        assert "screenings_today" in body
        assert "hits_found_today" in body
        assert "hits_cleared_today" in body
        assert "hits_pending_today" in body
    finally:
        app.dependency_overrides.pop(require("audit_read"), None)


# ── /aml/matches ──────────────────────────────────────────────────────────────

def test_matches_returns_list(client):
    from app.services.auth import require
    from app.main import app

    fake_principal = MagicMock()
    fake_principal.sub = "tester"
    fake_principal.tenant = "default"

    app.dependency_overrides[require("audit_read")] = lambda: fake_principal

    try:
        resp = client.get("/api/v1/aml/matches", headers=HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body
        assert "total" in body
        assert isinstance(body["items"], list)
    finally:
        app.dependency_overrides.pop(require("audit_read"), None)


# ── /aml/matches/bulk-review ──────────────────────────────────────────────────

def test_bulk_review_invalid_action(client):
    from app.services.auth import require
    from app.main import app

    fake_principal = MagicMock()
    fake_principal.sub = "tester"
    fake_principal.tenant = "default"

    app.dependency_overrides[require("approve")] = lambda: fake_principal

    try:
        resp = client.post(
            "/api/v1/aml/matches/bulk-review",
            json={"match_ids": [1], "action": "delete"},
            headers=HEADERS,
        )
        assert resp.status_code == 400
    finally:
        app.dependency_overrides.pop(require("approve"), None)


def test_bulk_review_not_found(client):
    from app.services.auth import require
    from app.main import app

    fake_principal = MagicMock()
    fake_principal.sub = "tester"
    fake_principal.tenant = "default"

    app.dependency_overrides[require("approve")] = lambda: fake_principal

    try:
        resp = client.post(
            "/api/v1/aml/matches/bulk-review",
            json={"match_ids": [999999], "action": "clear"},
            headers=HEADERS,
        )
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.pop(require("approve"), None)

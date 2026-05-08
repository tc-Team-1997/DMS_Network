"""
Tests for the CBS FastAPI router (/api/v1/cbs/*).

All tests use TestClient with the adapter monkeypatched to MockTemenosT24
— no network calls, no real CBS required.

Run time must stay under 5 seconds total.
"""
from __future__ import annotations

import os
import sys

import pytest

_pkg_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _pkg_root not in sys.path:
    sys.path.insert(0, _pkg_root)

# Force mocks globally so the registry never touches the real adapter.
os.environ.setdefault("INTEGRATIONS_USE_MOCKS", "true")
os.environ.setdefault("API_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

CLIENT = TestClient(app, raise_server_exceptions=True)
HEADERS = {"X-API-Key": "test-key"}


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/health
# ---------------------------------------------------------------------------


class TestCBSHealth:
    def test_health_returns_200(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/health", headers=HEADERS)
        assert resp.status_code == 200

    def test_health_returns_list(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/health", headers=HEADERS)
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    def test_health_item_has_required_fields(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/health", headers=HEADERS)
        item = resp.json()[0]
        assert "adapter" in item
        assert "ok" in item
        assert "detail" in item

    def test_health_temenos_adapter_ok(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/health", headers=HEADERS)
        adapters = {item["adapter"]: item for item in resp.json()}
        assert "temenos_t24" in adapters
        assert adapters["temenos_t24"]["ok"] is True

    def test_health_requires_api_key(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/health")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/customers/{cif}
# ---------------------------------------------------------------------------


class TestCBSGetCustomer:
    def test_get_customer_returns_200(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
        )
        assert resp.status_code == 200

    def test_get_customer_returns_cif(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert data["cif"] == "CIF001"

    def test_get_customer_returns_name(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert isinstance(data["name"], str)
        assert len(data["name"]) > 0

    def test_get_customer_returns_risk_band(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert data["risk_band"] in ("LOW", "MEDIUM", "HIGH", "UNKNOWN")

    def test_get_customer_returns_kyc_status(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert "kyc_status" in data

    def test_get_customer_returns_raw_dict(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert isinstance(data["raw"], dict)

    def test_get_customer_requires_api_key(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/customers/CIF001")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/customers/{cif}/accounts
# ---------------------------------------------------------------------------


class TestCBSListAccounts:
    def test_list_accounts_returns_200(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001/accounts",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
        )
        assert resp.status_code == 200

    def test_list_accounts_returns_list(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001/accounts",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert isinstance(data, list)

    def test_list_accounts_items_have_account_no(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001/accounts",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
        )
        for item in resp.json():
            assert "account_no" in item
            assert "cif" in item
            assert "currency" in item

    def test_list_accounts_requires_api_key(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/customers/CIF001/accounts")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/customers/{cif}/link-document
# ---------------------------------------------------------------------------


class TestCBSLinkDocument:
    def test_link_document_returns_200(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
            json={"document_id": 42},
        )
        assert resp.status_code == 200

    def test_link_document_returns_success_true(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
            json={"document_id": 42},
        )
        data = resp.json()
        assert data["success"] is True

    def test_link_document_returns_cif(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
            json={"document_id": 99},
        )
        data = resp.json()
        assert data["cif"] == "CIF001"

    def test_link_document_returns_doc_id(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
            json={"document_id": 77},
        )
        data = resp.json()
        assert data["doc_id"] == 77

    def test_link_document_returns_idempotency_key(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=HEADERS,
            params={"tenant_id": "test-tenant"},
            json={"document_id": 55},
        )
        data = resp.json()
        assert "idempotency_key" in data
        assert len(data["idempotency_key"]) == 32

    def test_link_document_is_idempotent(self) -> None:
        """Same (cif, doc_id) must produce the same idempotency key."""
        payload = {"document_id": 100}
        params = {"tenant_id": "test-tenant"}
        r1 = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=HEADERS,
            params=params,
            json=payload,
        )
        r2 = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=HEADERS,
            params=params,
            json=payload,
        )
        assert r1.json()["idempotency_key"] == r2.json()["idempotency_key"]

    def test_link_document_requires_api_key(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            json={"document_id": 1},
        )
        assert resp.status_code == 401

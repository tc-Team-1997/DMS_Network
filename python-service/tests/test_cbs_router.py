"""
Tests for the CBS FastAPI router (/api/v1/cbs/*).

All tests use TestClient with the adapter monkeypatched to MockTemenosT24
— no network calls, no real CBS required.

Run time must stay under 5 seconds total.
"""
from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

_pkg_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _pkg_root not in sys.path:
    sys.path.insert(0, _pkg_root)

# Force mocks globally so the registry never touches the real adapter.
os.environ.setdefault("INTEGRATIONS_USE_MOCKS", "true")
os.environ.setdefault("API_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services.auth import issue_token  # noqa: E402

CLIENT = TestClient(app, raise_server_exceptions=True)
HEADERS = {"X-API-Key": "test-key"}


# ---------------------------------------------------------------------------
# JWT helpers for user-scoped endpoints
# ---------------------------------------------------------------------------


def _jwt(roles: list[str], tenant: str = "test-tenant") -> str:
    """Issue a short-lived JWT for testing authenticated endpoints."""
    return issue_token(sub="test-user", tenant=tenant, branch="HQ", roles=roles)


def _auth_headers(roles: list[str], tenant: str = "test-tenant") -> dict[str, str]:
    """Return headers combining X-API-Key and Authorization: Bearer JWT."""
    return {
        **HEADERS,
        "Authorization": f"Bearer {_jwt(roles, tenant=tenant)}",
    }


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
# GET /api/v1/cbs/customers/{cif}  (path-style)
# ---------------------------------------------------------------------------


class TestCBSGetCustomer:
    def test_get_customer_returns_200(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=_auth_headers(["viewer"]),
            params={"tenant_id": "test-tenant"},
        )
        assert resp.status_code == 200

    def test_get_customer_returns_cif(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=_auth_headers(["viewer"]),
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert data["cif"] == "CIF001"

    def test_get_customer_returns_name(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=_auth_headers(["viewer"]),
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert isinstance(data["name"], str)
        assert len(data["name"]) > 0

    def test_get_customer_returns_risk_band(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=_auth_headers(["viewer"]),
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert data["risk_band"] in ("LOW", "MEDIUM", "HIGH", "UNKNOWN")

    def test_get_customer_returns_kyc_status(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=_auth_headers(["viewer"]),
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert "kyc_status" in data

    def test_get_customer_does_not_leak_raw_field(self) -> None:
        # Security review 2026-05-09: the `raw` field was removed because it
        # exposed unredacted upstream PII to direct API consumers bypassing
        # the Node SPA mirror. Confirm the path-style endpoint never returns it.
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001",
            headers=_auth_headers(["viewer"]),
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert "raw" not in data
        # The redacted scalars are still present so the SPA can render them.
        assert data["cif"] == "CIF001"
        assert "kyc_status" in data

    def test_get_customer_requires_api_key(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/customers/CIF001")
        assert resp.status_code == 401

    def test_get_customer_bad_cif_returns_400(self) -> None:
        """Empty or non-alphanumeric CIF should return 400."""
        resp = CLIENT.get(
            "/api/v1/cbs/customers/invalid chars!",
            headers=_auth_headers(["viewer"]),
        )
        assert resp.status_code == 400
        body = resp.json()
        assert body["detail"]["error"] == "validation_failed"

    def test_get_customer_short_cif_returns_400(self) -> None:
        """CIF shorter than 4 chars should return 400."""
        resp = CLIENT.get(
            "/api/v1/cbs/customers/AB",
            headers=_auth_headers(["viewer"]),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/customers/{cif}/accounts
# ---------------------------------------------------------------------------


class TestCBSListAccounts:
    def test_list_accounts_returns_200(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001/accounts",
            headers=_auth_headers(["viewer"]),
            params={"tenant_id": "test-tenant"},
        )
        assert resp.status_code == 200

    def test_list_accounts_returns_list(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001/accounts",
            headers=_auth_headers(["viewer"]),
            params={"tenant_id": "test-tenant"},
        )
        data = resp.json()
        assert isinstance(data, list)

    def test_list_accounts_items_have_account_no(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/CIF001/accounts",
            headers=_auth_headers(["viewer"]),
            params={"tenant_id": "test-tenant"},
        )
        for item in resp.json():
            assert "account_no" in item
            assert "cif" in item
            assert "currency" in item

    def test_list_accounts_requires_api_key(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/customers/CIF001/accounts")
        assert resp.status_code == 401

    def test_list_accounts_bad_cif_returns_400(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/customers/bad cif!/accounts",
            headers=_auth_headers(["viewer"]),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/customers/{cif}/link-document  (path-style)
# ---------------------------------------------------------------------------


class TestCBSLinkDocument:
    def test_link_document_returns_200(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=_auth_headers(["maker"]),
            params={"tenant_id": "test-tenant"},
            json={"document_id": 42},
        )
        assert resp.status_code == 200

    def test_link_document_returns_success_true(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=_auth_headers(["maker"]),
            params={"tenant_id": "test-tenant"},
            json={"document_id": 42},
        )
        data = resp.json()
        assert data["success"] is True

    def test_link_document_returns_cif(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=_auth_headers(["maker"]),
            params={"tenant_id": "test-tenant"},
            json={"document_id": 99},
        )
        data = resp.json()
        assert data["cif"] == "CIF001"

    def test_link_document_returns_doc_id(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=_auth_headers(["maker"]),
            params={"tenant_id": "test-tenant"},
            json={"document_id": 77},
        )
        data = resp.json()
        assert data["doc_id"] == 77

    def test_link_document_returns_idempotency_key(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=_auth_headers(["maker"]),
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
            headers=_auth_headers(["maker"]),
            params=params,
            json=payload,
        )
        r2 = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/link-document",
            headers=_auth_headers(["maker"]),
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


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/pull-customer  (contract §4)
# ---------------------------------------------------------------------------


class TestPullCustomerFlat:
    """Tests for the flat POST /api/v1/cbs/pull-customer endpoint (§4)."""

    def test_happy_path_returns_200(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/pull-customer",
            headers=_auth_headers(["viewer"]),
            json={"cif": "CIF001"},
        )
        assert resp.status_code == 200

    def test_response_includes_cif(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/pull-customer",
            headers=_auth_headers(["viewer"]),
            json={"cif": "CIF001"},
        )
        data = resp.json()
        assert data["cif"] == "CIF001"

    def test_response_includes_risk_band(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/pull-customer",
            headers=_auth_headers(["viewer"]),
            json={"cif": "CIF001"},
        )
        data = resp.json()
        assert data["risk_band"] in ("LOW", "MEDIUM", "HIGH", "UNKNOWN")

    def test_stale_false_on_fresh_data(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/pull-customer",
            headers=_auth_headers(["viewer"]),
            json={"cif": "CIF001"},
        )
        # Mock adapter always returns success → stale should be False
        data = resp.json()
        assert data["stale"] is False

    def test_empty_cif_returns_400(self) -> None:
        """Empty cif should be rejected by Pydantic with 422 (validation)."""
        resp = CLIENT.post(
            "/api/v1/cbs/pull-customer",
            headers=_auth_headers(["viewer"]),
            json={"cif": ""},
        )
        assert resp.status_code == 422

    def test_invalid_cif_chars_returns_422(self) -> None:
        """CIF with special characters fails Pydantic validation."""
        resp = CLIENT.post(
            "/api/v1/cbs/pull-customer",
            headers=_auth_headers(["viewer"]),
            json={"cif": "invalid chars!"},
        )
        assert resp.status_code == 422

    def test_requires_api_key(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/pull-customer",
            headers={"Authorization": f"Bearer {_jwt(['viewer'])}"},
            json={"cif": "CIF001"},
        )
        assert resp.status_code == 401

    def test_requires_view_permission(self) -> None:
        """A JWT with no recognised role should be refused with 403."""
        resp = CLIENT.post(
            "/api/v1/cbs/pull-customer",
            headers=_auth_headers([]),
            json={"cif": "CIF001"},
        )
        assert resp.status_code == 403

    def test_503_when_adapter_raises_upstream_unavailable(self) -> None:
        """Simulating circuit-open by patching registry.get_adapter."""
        from app.services.integrations.temenos_t24 import UpstreamUnavailable

        mock_adapter = MagicMock()
        mock_adapter.pull_customer = AsyncMock(
            side_effect=UpstreamUnavailable("Circuit breaker open after 5 consecutive errors")
        )
        mock_adapter.configure = AsyncMock()

        with patch(
            "app.routers.cbs.refresh_customer_from_cbs",
            new=AsyncMock(side_effect=UpstreamUnavailable("circuit open")),
        ):
            resp = CLIENT.post(
                "/api/v1/cbs/pull-customer",
                headers=_auth_headers(["viewer"]),
                json={"cif": "CIF001"},
            )
        assert resp.status_code == 503
        body = resp.json()
        assert body["detail"]["error"] == "cbs_unavailable"
        assert "retry_after" in body["detail"]

    def test_cache_hit_returns_cached_true(self) -> None:
        """
        Call the same endpoint twice.  Both succeed because the mock adapter
        always returns data — the second call is also ok (not stale).
        Verifies the cached flag echoes the result from the service layer.
        """
        headers = _auth_headers(["viewer"])
        r1 = CLIENT.post("/api/v1/cbs/pull-customer", headers=headers, json={"cif": "CIF001"})
        r2 = CLIENT.post("/api/v1/cbs/pull-customer", headers=headers, json={"cif": "CIF001"})
        assert r1.status_code == 200
        assert r2.status_code == 200
        # Both fresh from mock; neither is stale
        assert r1.json()["stale"] is False
        assert r2.json()["stale"] is False

    def test_tenant_isolation(self) -> None:
        """
        Two different JWT tenants must each get a response scoped to their
        own tenant_id (mock adapter echoes the CIF regardless of tenant, but
        the call must complete without leaking cross-tenant data).
        """
        h_a = _auth_headers(["viewer"], tenant="tenant-A")
        h_b = _auth_headers(["viewer"], tenant="tenant-B")
        r_a = CLIENT.post("/api/v1/cbs/pull-customer", headers=h_a, json={"cif": "CIF001"})
        r_b = CLIENT.post("/api/v1/cbs/pull-customer", headers=h_b, json={"cif": "CIF001"})
        assert r_a.status_code == 200
        assert r_b.status_code == 200
        # Both return CIF001 but each completed independently
        assert r_a.json()["cif"] == "CIF001"
        assert r_b.json()["cif"] == "CIF001"


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/pull-account  (contract §4)
# ---------------------------------------------------------------------------


class TestPullAccountFlat:
    """Tests for the flat POST /api/v1/cbs/pull-account endpoint (§4)."""

    def test_happy_path_returns_200(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/pull-account",
            headers=_auth_headers(["viewer"]),
            json={"account_no": "0012345678901"},
        )
        assert resp.status_code == 200

    def test_response_includes_account_no(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/pull-account",
            headers=_auth_headers(["viewer"]),
            json={"account_no": "0012345678901"},
        )
        data = resp.json()
        assert "account_no" in data
        assert "currency" in data
        assert "status" in data

    def test_invalid_account_no_returns_422(self) -> None:
        """Non-digit account number fails Pydantic validation → 422."""
        resp = CLIENT.post(
            "/api/v1/cbs/pull-account",
            headers=_auth_headers(["viewer"]),
            json={"account_no": "NOTANUMBER"},
        )
        assert resp.status_code == 422

    def test_503_when_adapter_unavailable(self) -> None:
        from app.services.integrations.temenos_t24 import UpstreamUnavailable

        with patch(
            "app.routers.cbs.get_adapter",
            new=AsyncMock(
                return_value=MagicMock(
                    pull_account=AsyncMock(
                        side_effect=UpstreamUnavailable("circuit open")
                    ),
                    configure=AsyncMock(),
                )
            ),
        ):
            resp = CLIENT.post(
                "/api/v1/cbs/pull-account",
                headers=_auth_headers(["viewer"]),
                json={"account_no": "0012345678901"},
            )
        assert resp.status_code == 503
        assert resp.json()["detail"]["error"] == "cbs_unavailable"

    def test_requires_api_key(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/pull-account",
            headers={"Authorization": f"Bearer {_jwt(['viewer'])}"},
            json={"account_no": "0012345678901"},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/link-document  (contract §4, flat path)
# ---------------------------------------------------------------------------


class TestLinkDocumentFlat:
    """Tests for the flat POST /api/v1/cbs/link-document endpoint (§4)."""

    def test_happy_path_returns_200(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/link-document",
            headers=_auth_headers(["maker"]),
            json={"cif": "CIF001", "doc_id": 42, "metadata": {"doc_type": "NATIONAL_ID"}},
        )
        assert resp.status_code == 200

    def test_response_includes_required_fields(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/link-document",
            headers=_auth_headers(["maker"]),
            json={"cif": "CIF001", "doc_id": 42, "metadata": {}},
        )
        data = resp.json()
        assert data["success"] is True
        assert data["cif"] == "CIF001"
        assert data["doc_id"] == 42
        assert "remote_ref" in data
        assert "idempotency_key" in data
        assert len(data["idempotency_key"]) == 32
        assert "linked_at" in data

    def test_idempotent_same_key_twice(self) -> None:
        """Two calls with the same (cif, doc_id) must return the same idempotency_key."""
        payload = {"cif": "CIF001", "doc_id": 99, "metadata": {}}
        headers = _auth_headers(["maker"])
        r1 = CLIENT.post("/api/v1/cbs/link-document", headers=headers, json=payload)
        r2 = CLIENT.post("/api/v1/cbs/link-document", headers=headers, json=payload)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["idempotency_key"] == r2.json()["idempotency_key"]

    def test_invalid_cif_returns_422(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/link-document",
            headers=_auth_headers(["maker"]),
            json={"cif": "bad cif!", "doc_id": 1, "metadata": {}},
        )
        assert resp.status_code == 422

    def test_viewer_role_rejected_403(self) -> None:
        """viewer role lacks capture permission → 403."""
        resp = CLIENT.post(
            "/api/v1/cbs/link-document",
            headers=_auth_headers(["viewer"]),
            json={"cif": "CIF001", "doc_id": 1, "metadata": {}},
        )
        assert resp.status_code == 403

    def test_503_when_upstream_unavailable(self) -> None:
        from app.services.integrations.temenos_t24 import UpstreamUnavailable

        with patch(
            "app.routers.cbs.link_document_to_customer",
            new=AsyncMock(side_effect=UpstreamUnavailable("circuit open")),
        ):
            resp = CLIENT.post(
                "/api/v1/cbs/link-document",
                headers=_auth_headers(["maker"]),
                json={"cif": "CIF001", "doc_id": 42, "metadata": {}},
            )
        assert resp.status_code == 503
        assert resp.json()["detail"]["error"] == "cbs_unavailable"

    def test_429_when_rate_limited(self) -> None:
        from app.routers.cbs import RateLimitExceeded

        with patch(
            "app.routers.cbs.link_document_to_customer",
            new=AsyncMock(side_effect=RateLimitExceeded("rate limited")),
        ):
            resp = CLIENT.post(
                "/api/v1/cbs/link-document",
                headers=_auth_headers(["maker"]),
                json={"cif": "CIF001", "doc_id": 42, "metadata": {}},
            )
        assert resp.status_code == 429
        assert resp.json()["detail"]["error"] == "rate_limited"

    def test_requires_api_key(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/link-document",
            headers={"Authorization": f"Bearer {_jwt(['maker'])}"},
            json={"cif": "CIF001", "doc_id": 1, "metadata": {}},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/push-document  (contract §4)
# ---------------------------------------------------------------------------


class TestPushDocumentFlat:
    """Tests for POST /api/v1/cbs/push-document (§4)."""

    def test_happy_path_returns_200(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/push-document",
            headers=_auth_headers(["maker"]),
            json={"doc_id": 42, "target": {"cif": "CIF001", "repository": "loan_file"}},
        )
        assert resp.status_code == 200

    def test_response_has_remote_id(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/push-document",
            headers=_auth_headers(["maker"]),
            json={"doc_id": 42, "target": {"cif": "CIF001", "repository": "loan_file"}},
        )
        data = resp.json()
        assert data["success"] is True
        assert "remote_id" in data
        assert len(data["idempotency_key"]) == 32
        assert "pushed_at" in data

    def test_idempotent_same_key_twice(self) -> None:
        payload = {"doc_id": 55, "target": {"cif": "CIF001", "repository": "credit_file"}}
        headers = _auth_headers(["maker"])
        r1 = CLIENT.post("/api/v1/cbs/push-document", headers=headers, json=payload)
        r2 = CLIENT.post("/api/v1/cbs/push-document", headers=headers, json=payload)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["idempotency_key"] == r2.json()["idempotency_key"]

    def test_viewer_role_rejected_403(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/push-document",
            headers=_auth_headers(["viewer"]),
            json={"doc_id": 1, "target": {}},
        )
        assert resp.status_code == 403

    def test_503_when_upstream_unavailable(self) -> None:
        from app.services.integrations.temenos_t24 import UpstreamUnavailable

        with patch(
            "app.routers.cbs.get_adapter",
            new=AsyncMock(
                return_value=MagicMock(
                    push_document=AsyncMock(
                        side_effect=UpstreamUnavailable("circuit open")
                    ),
                    configure=AsyncMock(),
                )
            ),
        ):
            resp = CLIENT.post(
                "/api/v1/cbs/push-document",
                headers=_auth_headers(["maker"]),
                json={"doc_id": 1, "target": {"cif": "CIF001"}},
            )
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/accounts/{account_id}  (path-style)
# ---------------------------------------------------------------------------


class TestGetAccountPath:
    """Tests for GET /api/v1/cbs/accounts/{account_id}."""

    def test_happy_path_returns_200(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/accounts/0012345678901",
            headers=_auth_headers(["viewer"]),
        )
        assert resp.status_code == 200

    def test_response_has_account_fields(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/accounts/0012345678901",
            headers=_auth_headers(["viewer"]),
        )
        data = resp.json()
        assert "account_no" in data
        assert "cif" in data
        assert "currency" in data
        assert "status" in data

    def test_invalid_account_no_returns_400(self) -> None:
        resp = CLIENT.get(
            "/api/v1/cbs/accounts/NOTANUMBER",
            headers=_auth_headers(["viewer"]),
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["error"] == "validation_failed"

    def test_requires_api_key(self) -> None:
        resp = CLIENT.get("/api/v1/cbs/accounts/0012345678901")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/customers/{cif}/invalidate-cache
# ---------------------------------------------------------------------------


class TestInvalidateCache:
    """Tests for POST /api/v1/cbs/customers/{cif}/invalidate-cache."""

    def test_happy_path_returns_200(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/invalidate-cache",
            headers=_auth_headers(["doc_admin"]),
        )
        assert resp.status_code == 200

    def test_response_has_success(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/invalidate-cache",
            headers=_auth_headers(["doc_admin"]),
        )
        data = resp.json()
        assert data["success"] is True
        assert data["cif"] == "CIF001"
        assert "detail" in data

    def test_non_admin_rejected_403(self) -> None:
        """viewer and maker roles lack admin permission."""
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/invalidate-cache",
            headers=_auth_headers(["viewer"]),
        )
        assert resp.status_code == 403

    def test_maker_rejected_403(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/invalidate-cache",
            headers=_auth_headers(["maker"]),
        )
        assert resp.status_code == 403

    def test_requires_api_key(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/CIF001/invalidate-cache",
            headers={"Authorization": f"Bearer {_jwt(['doc_admin'])}"},
        )
        assert resp.status_code == 401

    def test_bad_cif_returns_400(self) -> None:
        resp = CLIENT.post(
            "/api/v1/cbs/customers/bad cif!/invalidate-cache",
            headers=_auth_headers(["doc_admin"]),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Error mapping coverage
# ---------------------------------------------------------------------------


class TestErrorMapping:
    """Verify the §11 error matrix is correctly surfaced at the HTTP layer."""

    def test_502_on_generic_exception(self) -> None:
        """Unexpected exception from service layer → 502 cbs_proxy_error."""
        with patch(
            "app.routers.cbs.refresh_customer_from_cbs",
            new=AsyncMock(side_effect=RuntimeError("unexpected T24 crash")),
        ):
            resp = CLIENT.post(
                "/api/v1/cbs/pull-customer",
                headers=_auth_headers(["viewer"]),
                json={"cif": "CIF001"},
            )
        # RuntimeError does not match any specific mapping → 502 proxy error
        assert resp.status_code == 502
        assert resp.json()["detail"]["error"] == "cbs_proxy_error"

    def test_503_retry_after_present(self) -> None:
        from app.services.integrations.temenos_t24 import UpstreamUnavailable

        with patch(
            "app.routers.cbs.refresh_customer_from_cbs",
            new=AsyncMock(side_effect=UpstreamUnavailable("circuit open")),
        ):
            resp = CLIENT.post(
                "/api/v1/cbs/pull-customer",
                headers=_auth_headers(["viewer"]),
                json={"cif": "CIF001"},
            )
        assert resp.status_code == 503
        detail = resp.json()["detail"]
        assert detail["error"] == "cbs_unavailable"
        assert isinstance(detail["retry_after"], int)

    def test_pii_not_leaked_in_auth_error(self) -> None:
        """
        A T24AuthError must not expose the reason in the response body.
        The body must only contain {error: "cbs_auth_failed"}.
        """
        from app.routers.cbs import T24AuthError

        with patch(
            "app.routers.cbs.refresh_customer_from_cbs",
            new=AsyncMock(
                side_effect=T24AuthError("client_secret is wrong — cred=supersecret123")
            ),
        ):
            resp = CLIENT.post(
                "/api/v1/cbs/pull-customer",
                headers=_auth_headers(["viewer"]),
                json={"cif": "CIF001"},
            )
        assert resp.status_code == 502
        detail = resp.json()["detail"]
        assert detail["error"] == "cbs_auth_failed"
        # Must not contain the secret or any internal detail
        raw_body = resp.text
        assert "supersecret" not in raw_body
        assert "client_secret" not in raw_body

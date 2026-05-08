"""
Contract + mock-backed integration tests for the Temenos T24 adapter.

Test categories
---------------
(a) Contract tests — verify that MockTemenosT24 satisfies the Adapter Protocol
    shape (callable methods, required attributes).
(b) Mock-backed integration tests — exercise every Protocol method end-to-end
    against MockTemenosT24 and assert on return types and invariants.
(c) Smoke test — skipped unless T24_SANDBOX_BASE_URL + T24_SANDBOX_API_KEY
    are set in the environment; runs against the real sandbox.

Requires: pytest-asyncio  (installed as a dev dependency)
"""
from __future__ import annotations

import hashlib
import inspect
import os
import sys

import pytest

# Gate on pytest-asyncio being importable — import the plugin explicitly so
# the skip message is clear when the package is absent.
pytest_asyncio = pytest.importorskip("pytest_asyncio", reason="pytest-asyncio not installed")

# Ensure the python-service package root is on sys.path so this test file can
# be run both from the repo root and from inside python-service/.
_pkg_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _pkg_root not in sys.path:
    sys.path.insert(0, _pkg_root)

from app.services.integrations import (  # noqa: E402
    Adapter,
    CustomerRecord,
    Document,
    HealthStatus,
    MockTemenosT24,
    PushResult,
    RemoteDoc,
    TemenosT24,
    get_adapter,
    make_idempotency_key,
)

# ---------------------------------------------------------------------------
# Constants shared across tests
# ---------------------------------------------------------------------------

TENANT = "bank-eg-test-001"
CID = "CID-123"
DOC_ID = "doc-abc-456"
ADAPTER_NAME = "temenos_t24"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _has_async_method(obj: object, method: str) -> bool:
    m = getattr(obj, method, None)
    return m is not None and inspect.iscoroutinefunction(m)


# ---------------------------------------------------------------------------
# (a) Contract tests — Protocol shape
# ---------------------------------------------------------------------------


class TestAdapterProtocolShape:
    """Verify MockTemenosT24 satisfies the Adapter Protocol structurally."""

    def test_mock_has_name_attribute(self) -> None:
        adapter = MockTemenosT24()
        assert isinstance(adapter.name, str)
        assert adapter.name == ADAPTER_NAME

    def test_mock_has_configure(self) -> None:
        assert _has_async_method(MockTemenosT24(), "configure")

    def test_mock_has_health(self) -> None:
        assert _has_async_method(MockTemenosT24(), "health")

    def test_mock_has_pull_customer(self) -> None:
        assert _has_async_method(MockTemenosT24(), "pull_customer")

    def test_mock_has_pull_documents(self) -> None:
        assert _has_async_method(MockTemenosT24(), "pull_documents")

    def test_mock_has_push_document(self) -> None:
        assert _has_async_method(MockTemenosT24(), "push_document")

    def test_mock_is_instance_of_adapter_protocol(self) -> None:
        """runtime_checkable Protocol check."""
        adapter = MockTemenosT24()
        assert isinstance(adapter, Adapter)

    def test_real_has_name_attribute(self) -> None:
        adapter = TemenosT24()
        assert adapter.name == ADAPTER_NAME

    def test_real_is_instance_of_adapter_protocol(self) -> None:
        adapter = TemenosT24()
        assert isinstance(adapter, Adapter)


# ---------------------------------------------------------------------------
# (b) Mock-backed integration tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestMockTemenosT24Integration:
    """End-to-end tests driven by MockTemenosT24 — no network required."""

    @pytest_asyncio.fixture
    async def adapter(self) -> MockTemenosT24:
        a = MockTemenosT24()
        await a.configure(TENANT, {"rate_limit_rps": 100})
        return a

    # -- configure ----------------------------------------------------------

    async def test_configure_sets_tenant_id(self, adapter: MockTemenosT24) -> None:
        assert adapter.tenant_id == TENANT

    # -- health -------------------------------------------------------------

    async def test_health_returns_health_status(self, adapter: MockTemenosT24) -> None:
        result = await adapter.health()
        assert isinstance(result, HealthStatus)

    async def test_health_ok_is_true(self, adapter: MockTemenosT24) -> None:
        result = await adapter.health()
        assert result.ok is True

    async def test_health_adapter_field_matches_name(self, adapter: MockTemenosT24) -> None:
        result = await adapter.health()
        assert result.adapter == ADAPTER_NAME

    # -- pull_customer ------------------------------------------------------

    async def test_pull_customer_returns_customer_record(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_customer(CID)
        assert isinstance(record, CustomerRecord)

    async def test_pull_customer_cid_matches(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_customer(CID)
        assert record.cid == CID

    async def test_pull_customer_name_is_non_empty(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_customer(CID)
        assert record.name and len(record.name.strip()) > 0

    async def test_pull_customer_has_known_risk_band(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_customer(CID)
        assert record.risk_band in ("LOW", "MEDIUM", "HIGH", "UNKNOWN")

    # -- pull_documents -----------------------------------------------------

    async def test_pull_documents_returns_list(self, adapter: MockTemenosT24) -> None:
        docs = await adapter.pull_documents(CID)
        assert isinstance(docs, list)

    async def test_pull_documents_is_non_empty(self, adapter: MockTemenosT24) -> None:
        docs = await adapter.pull_documents(CID)
        assert len(docs) > 0

    async def test_pull_documents_items_are_remote_doc(self, adapter: MockTemenosT24) -> None:
        docs = await adapter.pull_documents(CID)
        for doc in docs:
            assert isinstance(doc, RemoteDoc)

    async def test_pull_documents_remote_ids_are_non_empty(self, adapter: MockTemenosT24) -> None:
        docs = await adapter.pull_documents(CID)
        for doc in docs:
            assert doc.remote_id and len(doc.remote_id.strip()) > 0

    # -- push_document ------------------------------------------------------

    def _make_doc(self) -> Document:
        return Document(
            id=DOC_ID,
            doc_type="NATIONAL_ID",
            title="National ID scan",
            content=b"PDF-content-placeholder",
            mime_type="application/pdf",
        )

    async def test_push_document_returns_push_result(self, adapter: MockTemenosT24) -> None:
        result = await adapter.push_document(self._make_doc(), {"folder": "KYC"})
        assert isinstance(result, PushResult)

    async def test_push_document_success_is_true(self, adapter: MockTemenosT24) -> None:
        result = await adapter.push_document(self._make_doc(), {"folder": "KYC"})
        assert result.success is True

    async def test_push_document_idempotency_key_is_32_chars(self, adapter: MockTemenosT24) -> None:
        result = await adapter.push_document(self._make_doc(), {"folder": "KYC"})
        assert len(result.idempotency_key) == 32

    async def test_push_document_idempotency_key_derivation(self, adapter: MockTemenosT24) -> None:
        """
        Key must equal the first 32 hex chars of SHA-256 of
        "{tenant_id}|{doc_id}|{adapter_name}|{target_hash}".
        """
        target = {"folder": "KYC"}
        target_hash = hashlib.sha256(str(sorted(target.items())).encode()).hexdigest()[:16]
        expected_key = make_idempotency_key(TENANT, DOC_ID, ADAPTER_NAME, target_hash)
        result = await adapter.push_document(self._make_doc(), target)
        assert result.idempotency_key == expected_key

    async def test_push_document_idempotency_is_stable(self, adapter: MockTemenosT24) -> None:
        """Repeated pushes with identical args must yield the same idempotency key."""
        doc = self._make_doc()
        target = {"folder": "KYC"}
        r1 = await adapter.push_document(doc, target)
        r2 = await adapter.push_document(doc, target)
        assert r1.idempotency_key == r2.idempotency_key

    async def test_push_document_adapter_field_matches_name(self, adapter: MockTemenosT24) -> None:
        result = await adapter.push_document(self._make_doc(), {})
        assert result.adapter == ADAPTER_NAME

    async def test_push_document_tenant_field_matches(self, adapter: MockTemenosT24) -> None:
        result = await adapter.push_document(self._make_doc(), {})
        assert result.tenant_id == TENANT

    # -- tenant isolation ---------------------------------------------------

    async def test_two_tenants_do_not_share_state(self) -> None:
        a1 = MockTemenosT24()
        a2 = MockTemenosT24()
        await a1.configure("tenant-alpha", {})
        await a2.configure("tenant-beta", {})
        assert a1.tenant_id != a2.tenant_id
        assert a1 is not a2

    # -- registry -----------------------------------------------------------

    async def test_get_adapter_mock_prefix_returns_mock(self) -> None:
        adapter = await get_adapter("mock_temenos_t24", TENANT, {})
        assert isinstance(adapter, MockTemenosT24)

    async def test_get_adapter_sets_tenant(self) -> None:
        adapter = await get_adapter("mock_temenos_t24", TENANT, {})
        assert adapter.tenant_id == TENANT  # type: ignore[union-attr]

    async def test_get_adapter_unknown_name_raises(self) -> None:
        with pytest.raises(KeyError, match="Unknown adapter"):
            await get_adapter("nonexistent_bank", TENANT, {})


# ---------------------------------------------------------------------------
# (c) Smoke test — skipped unless sandbox credentials are present
# ---------------------------------------------------------------------------


SANDBOX_URL = os.getenv("T24_SANDBOX_BASE_URL", "")
SANDBOX_KEY = os.getenv("T24_SANDBOX_API_KEY", "")
_SANDBOX_AVAILABLE = bool(SANDBOX_URL and SANDBOX_KEY)


@pytest.mark.asyncio
@pytest.mark.skipif(not _SANDBOX_AVAILABLE, reason="T24_SANDBOX_BASE_URL / T24_SANDBOX_API_KEY not set")
class TestTemenosT24SandboxSmoke:
    """Smoke tests that run only when real sandbox credentials are present."""

    @pytest_asyncio.fixture
    async def adapter(self) -> TemenosT24:
        a = TemenosT24()
        await a.configure(TENANT, {"base_url": SANDBOX_URL, "api_key": SANDBOX_KEY})
        return a

    async def test_sandbox_health(self, adapter: TemenosT24) -> None:
        status = await adapter.health()
        assert isinstance(status, HealthStatus)
        # We don't assert ok=True because the sandbox may be down; we only
        # assert the call completes without raising an unhandled exception.

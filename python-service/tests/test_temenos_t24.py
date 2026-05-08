"""
Tests for the Temenos T24 adapter.

Two sets:
(a) TEMENOS_BASE_URL unset — factory returns MockTemenosT24; fixture data is asserted.
(b) TEMENOS_BASE_URL set   — real TemenosT24 is instantiated; httpx.MockTransport is
    used to verify request URL shape and auth headers match the Temenos IRIS contract.

Run time must stay under 5 seconds.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import pytest

_pkg_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _pkg_root not in sys.path:
    sys.path.insert(0, _pkg_root)

pytest_asyncio = pytest.importorskip("pytest_asyncio", reason="pytest-asyncio not installed")
httpx = pytest.importorskip("httpx", reason="httpx not installed")

from app.services.integrations.temenos_t24 import (  # noqa: E402
    MockTemenosT24,
    TemenosT24,
    get_temenos_adapter,
    UpstreamUnavailable,
)
from app.services.integrations.base import (  # noqa: E402
    CustomerRecord,
    AccountRecord,
    HealthStatus,
)

TENANT = "bank-eg-test-001"
CIF001 = "CIF001"


# ---------------------------------------------------------------------------
# (a) When TEMENOS_BASE_URL is unset, factory returns mock; fixture is served
# ---------------------------------------------------------------------------


class TestFactoryReturnsMockWhenNoBaseUrl:
    """get_temenos_adapter() must return MockTemenosT24 when TEMENOS_BASE_URL is unset."""

    def test_factory_returns_mock_when_env_unset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("TEMENOS_BASE_URL", raising=False)
        adapter = get_temenos_adapter()
        assert isinstance(adapter, MockTemenosT24), (
            "Expected MockTemenosT24 when TEMENOS_BASE_URL is unset"
        )

    def test_factory_returns_real_when_env_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TEMENOS_BASE_URL", "https://t24.bank.local")
        adapter = get_temenos_adapter()
        assert isinstance(adapter, TemenosT24)

    def test_mock_name_attribute(self) -> None:
        adapter = MockTemenosT24()
        assert adapter.name == "temenos_t24"


@pytest.mark.asyncio
class TestMockAdapterFixtureData:
    """Mock adapter returns fixture data for CIF001."""

    @pytest_asyncio.fixture
    async def adapter(self) -> MockTemenosT24:
        a = MockTemenosT24()
        await a.configure(TENANT, {})
        return a

    async def test_pull_customer_cif001_name(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_customer(CIF001)
        assert isinstance(record, CustomerRecord)
        # The fixture temenos_customer.json has customerName: "Fatima Al-Zahraa Mostafa"
        assert record.name == "Fatima Al-Zahraa Mostafa"

    async def test_pull_customer_cif001_kyc_status(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_customer(CIF001)
        assert record.kyc_status == "VERIFIED"

    async def test_pull_customer_cif001_risk_band(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_customer(CIF001)
        assert record.risk_band == "LOW"

    async def test_pull_customer_cif001_national_id(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_customer(CIF001)
        assert record.national_id == "29901010123456"

    async def test_pull_customer_cif_echoed(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_customer(CIF001)
        assert record.cid == CIF001

    async def test_pull_account_fixture_data(self, adapter: MockTemenosT24) -> None:
        record = await adapter.pull_account("0011234560101")
        assert isinstance(record, AccountRecord)
        assert record.currency == "EGP"
        assert record.status == "ACTIVE"
        assert record.available_balance == "125000.00"

    async def test_health_returns_ok(self, adapter: MockTemenosT24) -> None:
        hs = await adapter.health()
        assert isinstance(hs, HealthStatus)
        assert hs.ok is True

    async def test_post_document_link_idempotent(self, adapter: MockTemenosT24) -> None:
        r1 = await adapter.post_document_link(CIF001, 42, {})
        r2 = await adapter.post_document_link(CIF001, 42, {})
        assert r1.idempotency_key == r2.idempotency_key

    async def test_pull_documents_non_empty(self, adapter: MockTemenosT24) -> None:
        docs = await adapter.pull_documents(CIF001)
        assert len(docs) >= 1
        assert docs[0].remote_id == "T24-DOC-CIF001-001"


# ---------------------------------------------------------------------------
# (b) TemenosT24 with httpx.MockTransport — verify URL + header contract
# ---------------------------------------------------------------------------


class _MockHTTPTransport(httpx.AsyncBaseTransport):
    """Capture the request for inspection after the call."""

    def __init__(self, response_body: dict, status_code: int = 200) -> None:
        self._response_body = response_body
        self._status_code = status_code
        self.last_request: httpx.Request | None = None

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.last_request = request
        return httpx.Response(
            status_code=self._status_code,
            headers={"Content-Type": "application/json"},
            content=json.dumps(self._response_body).encode(),
        )


@pytest.mark.asyncio
class TestRealAdapterWithMockTransport:
    """
    TemenosT24 makes requests to the right Temenos IRIS v2 endpoints
    and attaches the correct auth headers.
    """

    _BASE_URL = "https://t24.bank.test"
    _CUSTOMER_FIXTURE = {
        "body": {
            "customerName": "Test User",
            "nationalId": "000000000",
            "emailAddress": "test@example.com",
            "phoneNumber": "+20100000000",
            "kycStatus": "VERIFIED",
            "riskBand": "LOW",
            "accounts": [],
        }
    }
    _ACCOUNT_FIXTURE = {
        "body": {
            "currency": "EGP",
            "customer": CIF001,
            "status": "ACTIVE",
            "productCode": "SAVCUR",
            "availableBalance": "0.00",
            "branchId": "HQ",
            "openingDate": "20200101",
        }
    }
    _HEALTH_FIXTURE = {"header": {"version": "R23"}}

    async def _make_real_adapter(self, transport: _MockHTTPTransport) -> TemenosT24:
        adapter = TemenosT24()
        adapter._client = httpx.AsyncClient(transport=transport, base_url=self._BASE_URL)
        await adapter.configure(
            TENANT,
            {
                "base_url": self._BASE_URL,
                "auth_mode": "aa_signed",
                "aa_key_id": "TEST_KEY",
                "aa_secret": "TEST_SECRET",
            },
        )
        # Re-inject transport after configure() (configure replaces the client)
        adapter._client = httpx.AsyncClient(transport=transport, base_url=self._BASE_URL)
        return adapter

    async def test_pull_customer_request_url(self) -> None:
        transport = _MockHTTPTransport(self._CUSTOMER_FIXTURE)
        adapter = await self._make_real_adapter(transport)
        await adapter.pull_customer(CIF001)
        assert transport.last_request is not None
        assert f"/api/v2.0.0/holdings/customers/{CIF001}" in str(transport.last_request.url)

    async def test_pull_customer_aa_headers_present(self) -> None:
        transport = _MockHTTPTransport(self._CUSTOMER_FIXTURE)
        adapter = await self._make_real_adapter(transport)
        await adapter.pull_customer(CIF001)
        req = transport.last_request
        assert req is not None
        headers = dict(req.headers)
        assert "aa-keyid" in headers or "AA-KeyId" in headers or any(
            k.lower() == "aa-keyid" for k in headers
        )

    async def test_pull_account_request_url(self) -> None:
        transport = _MockHTTPTransport(self._ACCOUNT_FIXTURE)
        adapter = await self._make_real_adapter(transport)
        await adapter.pull_account("0011234560101")
        assert transport.last_request is not None
        assert "/api/v2.0.0/holdings/accounts/0011234560101" in str(transport.last_request.url)

    async def test_pull_customer_returns_customer_record(self) -> None:
        transport = _MockHTTPTransport(self._CUSTOMER_FIXTURE)
        adapter = await self._make_real_adapter(transport)
        record = await adapter.pull_customer(CIF001)
        assert isinstance(record, CustomerRecord)
        assert record.name == "Test User"
        assert record.kyc_status == "VERIFIED"

    async def test_circuit_breaker_trips_after_five_errors(self) -> None:
        """After 5 consecutive 5xx responses the circuit breaker opens."""
        transport = _MockHTTPTransport({"error": "server error"}, status_code=500)
        adapter = await self._make_real_adapter(transport)
        # Trip the circuit by exhausting the threshold
        for _ in range(adapter._CIRCUIT_TRIP_THRESHOLD):
            try:
                await adapter.pull_customer(CIF001)
            except (UpstreamUnavailable, Exception):
                pass
        # Next call must raise UpstreamUnavailable
        with pytest.raises(UpstreamUnavailable):
            await adapter.pull_customer(CIF001)

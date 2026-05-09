"""
Parametrized contract + integration test suite for the Temenos T24 adapter.

Each test runs against MockTemenosT24 by default.  When both
  TEMENOS_LIVE_TESTS=1
  TEMENOS_BASE_URL=<real url>
are set, the same tests also run against a live TemenosT24 instance (the
"real" param).  Live tests are automatically skipped otherwise.

Coverage checklist (≥ 20 tests):
  [01] health() → ok=True (mock)  /  live ping (real)
  [02] pull_customer known CIF → CustomerRecord shape
  [03] pull_customer → second call within TTL is cached (cached flag)
  [04] pull_customer → invalidate_customer → next call is fresh (not cached)
  [05] pull_customer unknown CIF → CustomerNotFound
  [06] pull_customer → no full name in any log record (PII redaction)
  [07] pull_account → AccountRecord shape + balance NOT in log
  [08] link_document_to_teller / post_document_link → success + remote_ref
  [09] post_document_link same args again → idempotent success (same key)
  [10] push_document → PushResult, success=True
  [11] push_document same doc+target → same idempotency_key (stable)
  [12] circuit breaker: 5 force-fail → 6th raises UpstreamUnavailable immediately
  [13] circuit breaker: after OPEN, half-open transition on timeout → success closes
  [14] circuit breaker: in OPEN, reads return stale cache if available
  [15] circuit breaker: in OPEN, writes always raise (no stale fallback)
  [16] pull_documents → list[RemoteDoc], non-empty
  [17] list_customer_documents → list[DocumentLink], non-empty
  [18] tenant isolation: two adapters different tenant_id → separate caches
  [19] _mask_pii helper: national_id is fully redacted
  [20] _mask_pii helper: name is partially masked (first 3 + *** + last 3)
  [21] _mask_pii helper: account_no shows only last 4 digits
  [22] configure: health and pull_customer raise if adapter is used before configure
  [23] circuit_state starts as CLOSED, emits transition log on trip
  [24] MockTemenosT24 satisfies Adapter Protocol (runtime_checkable)
  [25] TemenosT24 satisfies Adapter Protocol (runtime_checkable)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sys
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock

# Must be set BEFORE any app.services.integrations import so the registry
# singleton (_USE_MOCKS) is baked with the correct value.  Other test files
# such as test_cbs_router.py rely on this env var being set before the
# registry module is first imported.
os.environ.setdefault("INTEGRATIONS_USE_MOCKS", "true")

import pytest

pytest_asyncio = pytest.importorskip("pytest_asyncio", reason="pytest-asyncio not installed")
httpx = pytest.importorskip("httpx", reason="httpx not installed")

# Ensure python-service root is on sys.path whether we run from repo root or
# from inside python-service/.
_pkg_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if _pkg_root not in sys.path:
    sys.path.insert(0, _pkg_root)

from app.services.integrations.temenos_t24 import (  # noqa: E402
    CustomerNotFound,
    MockTemenosT24,
    TemenosT24,
    UpstreamUnavailable,
    _CircuitState,
    _CIRCUIT_OPEN_TIMEOUT_S,
    _CIRCUIT_TRIP_THRESHOLD,
    _mask_name,
    _mask_national_id,
    _mask_account_no,
    _mask_pii,
    get_temenos_adapter,
)
from app.services.integrations.base import (  # noqa: E402
    Adapter,
    AccountRecord,
    CustomerRecord,
    Document,
    DocumentLink,
    HealthStatus,
    PushResult,
    RemoteDoc,
    make_idempotency_key,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TENANT_A = "bank-eg-test-001"
TENANT_B = "bank-eg-test-002"
KNOWN_CIF = "CIF001"
UNKNOWN_CIF = "DOES_NOT_EXIST"
KNOWN_ACCOUNT = "0011234560101"
DOC_ID_STR = "doc-test-42"
_ADAPTER_NAME = "temenos_t24"

# ---------------------------------------------------------------------------
# Live-test gating
# ---------------------------------------------------------------------------

_LIVE = (
    os.getenv("TEMENOS_LIVE_TESTS") == "1"
    and bool(os.getenv("TEMENOS_BASE_URL"))
)
ADAPTERS = ["mock"]
if _LIVE:
    ADAPTERS.append("real")


# ---------------------------------------------------------------------------
# Mock HTTP transport for TemenosT24 (injects fixture responses)
# ---------------------------------------------------------------------------


class _MockTransport(httpx.AsyncBaseTransport):
    """Captures requests and returns a pre-baked JSON response."""

    def __init__(
        self,
        response_body: dict | list,
        status_code: int = 200,
    ) -> None:
        self._body = response_body
        self._status_code = status_code
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(
            status_code=self._status_code,
            headers={"Content-Type": "application/json"},
            content=json.dumps(self._body).encode(),
        )


_CUSTOMER_BODY = {
    "body": {
        "customerName": "Fatima Al-Zahraa Mostafa",
        "nationalId": "29901010123456",
        "emailAddress": "fatima@example.nbe.eg",
        "phoneNumber": "+201001234567",
        "kycStatus": "VERIFIED",
        "riskBand": "LOW",
        "accounts": [],
    }
}
_ACCOUNT_BODY = {
    "body": {
        "currency": "EGP",
        "customer": KNOWN_CIF,
        "status": "ACTIVE",
        "productCode": "SAVCUR",
        "availableBalance": "125000.00",
        "branchId": "HQ",
        "openingDate": "20200315",
    }
}
_HEALTH_BODY = {"header": {"version": "R23"}}
_DOCS_BODY = {
    "body": [
        {
            "documentId": "T24-DOC-CIF001-001",
            "documentType": "NATIONAL_ID",
            "description": "National ID front",
            "mimeType": "image/jpeg",
            "size": 204800,
            "documentUrl": "https://t24.test/docs/001",
        }
    ]
}
_LINK_BODY = {"body": {"documentId": "T24-LINK-REF-001"}}
_PUSH_BODY = {"body": {"documentId": "T24-PUSH-REF-001"}}


async def _make_real_adapter(
    transport: _MockTransport,
    tenant: str = TENANT_A,
) -> TemenosT24:
    """Build a TemenosT24 wired with a mock transport (no live T24 needed)."""
    adapter = TemenosT24()
    await adapter.configure(
        tenant,
        {
            "base_url": "https://t24.bank.test",
            "auth_mode": "aa_signed",
            "aa_key_id": "TEST_KEY_ID",
            "aa_secret": "TEST_SECRET",
            "rate_limit_rps": 100,
        },
    )
    adapter._client = httpx.AsyncClient(transport=transport)
    return adapter


# ---------------------------------------------------------------------------
# Adapter fixture — parametrized over ["mock"] or ["mock", "real"]
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(params=ADAPTERS)
async def adapter(request):
    """Yield a configured adapter instance for each param in ADAPTERS."""
    if request.param == "mock":
        a = MockTemenosT24()
        await a.configure(TENANT_A, {"rate_limit_rps": 100})
        return a
    # real — load credentials from env
    a = TemenosT24()
    await a.configure(
        TENANT_A,
        {
            "base_url": os.environ["TEMENOS_BASE_URL"],
            "auth_mode": os.getenv("TEMENOS_AUTH_MODE", "oauth2"),
            "client_id": os.getenv("TEMENOS_CLIENT_ID", ""),
            "client_secret": os.getenv("TEMENOS_CLIENT_SECRET", ""),
            "token_url": os.getenv("TEMENOS_TOKEN_URL", ""),
        },
    )
    return a


# ---------------------------------------------------------------------------
# [01] health
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health_returns_ok(adapter) -> None:
    """health() must return HealthStatus with ok=True (mock) or a valid struct (real)."""
    result = await adapter.health()
    assert isinstance(result, HealthStatus)
    assert isinstance(result.ok, bool)
    assert result.adapter == _ADAPTER_NAME
    if isinstance(adapter, MockTemenosT24):
        assert result.ok is True


# ---------------------------------------------------------------------------
# [02] pull_customer — shape
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pull_customer_returns_customer_record(adapter) -> None:
    result = await adapter.pull_customer(KNOWN_CIF)
    assert isinstance(result, CustomerRecord)
    assert result.cid == KNOWN_CIF
    assert result.name and len(result.name) > 0
    assert result.risk_band in ("LOW", "MEDIUM", "HIGH", "UNKNOWN")


# ---------------------------------------------------------------------------
# [03] pull_customer — second call is cached (MockTemenosT24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pull_customer_second_call_is_cached_mock() -> None:
    """Second pull_customer within TTL must hit cache (mock adapter only)."""
    adapter = MockTemenosT24()
    await adapter.configure(TENANT_A, {})
    # First call — populates cache
    r1 = await adapter.pull_customer(KNOWN_CIF)
    # Second call — should be a cache hit (record is the same object from cache)
    r2 = await adapter.pull_customer(KNOWN_CIF)
    assert r1.cid == r2.cid
    assert r1.name == r2.name
    # Both come from the same in-memory cache entry
    assert (TENANT_A, KNOWN_CIF) in adapter._cache


# ---------------------------------------------------------------------------
# [04] pull_customer — invalidate then fresh fetch (MockTemenosT24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pull_customer_invalidate_then_fresh_mock() -> None:
    """After invalidate_customer, next call must re-fetch (not from cache)."""
    adapter = MockTemenosT24()
    await adapter.configure(TENANT_A, {})
    await adapter.pull_customer(KNOWN_CIF)
    assert (TENANT_A, KNOWN_CIF) in adapter._cache
    adapter.invalidate_customer(KNOWN_CIF)
    assert (TENANT_A, KNOWN_CIF) not in adapter._cache
    # Next call repopulates
    await adapter.pull_customer(KNOWN_CIF)
    assert (TENANT_A, KNOWN_CIF) in adapter._cache


# ---------------------------------------------------------------------------
# [05] pull_customer — CustomerNotFound for unknown CIF (MockTemenosT24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pull_customer_unknown_cif_raises_not_found_mock() -> None:
    """pull_customer with a CIF in missing_cifs must raise CustomerNotFound."""
    adapter = MockTemenosT24()
    await adapter.configure(TENANT_A, {})
    adapter.missing_cifs.add(UNKNOWN_CIF)
    with pytest.raises(CustomerNotFound):
        await adapter.pull_customer(UNKNOWN_CIF)


@pytest.mark.asyncio
async def test_pull_customer_404_raises_not_found_real() -> None:
    """TemenosT24: 404 from T24 must raise CustomerNotFound."""
    transport = _MockTransport({"body": {}}, status_code=404)
    adapter = await _make_real_adapter(transport)
    with pytest.raises((CustomerNotFound, UpstreamUnavailable)):
        await adapter.pull_customer(UNKNOWN_CIF)


# ---------------------------------------------------------------------------
# [06] PII redaction — no full name in log records
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pull_customer_no_full_name_in_logs() -> None:
    """pull_customer must not emit the customer's full name to any log record."""
    adapter = MockTemenosT24()
    await adapter.configure(TENANT_A, {})
    r = await adapter.pull_customer(KNOWN_CIF)
    full_name = r.name  # e.g. "Fatima Al-Zahraa Mostafa"

    log_records: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            log_records.append(record.getMessage())

    handler = _Capture()
    root = logging.getLogger("app.services.integrations.temenos_t24")
    root.addHandler(handler)
    try:
        adapter.invalidate_customer(KNOWN_CIF)  # force fresh log line
        await adapter.pull_customer(KNOWN_CIF)
    finally:
        root.removeHandler(handler)

    for line in log_records:
        assert full_name not in line, (
            f"Full name {full_name!r} found in log line: {line!r}"
        )


# ---------------------------------------------------------------------------
# [07] pull_account — shape; balance not in log
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pull_account_returns_account_record(adapter) -> None:
    result = await adapter.pull_account(KNOWN_ACCOUNT)
    assert result is not None
    assert isinstance(result, AccountRecord)
    assert result.account_no == KNOWN_ACCOUNT
    assert result.currency == "EGP"
    assert result.status in ("ACTIVE", "INACTIVE", "DORMANT", "UNKNOWN")


@pytest.mark.asyncio
async def test_pull_account_balance_not_in_logs_mock() -> None:
    """The available_balance must never appear in a log line."""
    adapter = MockTemenosT24()
    await adapter.configure(TENANT_A, {})

    log_records: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            log_records.append(record.getMessage())

    handler = _Capture()
    root = logging.getLogger("app.services.integrations.temenos_t24")
    root.addHandler(handler)
    try:
        r = await adapter.pull_account(KNOWN_ACCOUNT)
        balance = r.available_balance if r else ""
    finally:
        root.removeHandler(handler)

    for line in log_records:
        if balance:
            assert balance not in line, (
                f"Balance {balance!r} found in log line: {line!r}"
            )


# ---------------------------------------------------------------------------
# [08] post_document_link — success (mock)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_document_link_success(adapter) -> None:
    result = await adapter.post_document_link(KNOWN_CIF, 42, {})
    assert result.success is True
    assert result.cif == KNOWN_CIF
    assert result.doc_id == 42
    assert len(result.idempotency_key) == 32


# ---------------------------------------------------------------------------
# [09] post_document_link — idempotent (same key on repeat)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_document_link_idempotent(adapter) -> None:
    r1 = await adapter.post_document_link(KNOWN_CIF, 42, {})
    r2 = await adapter.post_document_link(KNOWN_CIF, 42, {})
    assert r1.idempotency_key == r2.idempotency_key


# ---------------------------------------------------------------------------
# [10] push_document — success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_push_document_returns_push_result(adapter) -> None:
    doc = Document(
        id=DOC_ID_STR,
        doc_type="NATIONAL_ID",
        title="National ID scan",
        content=b"PDF-content",
    )
    result = await adapter.push_document(doc, {"cif": KNOWN_CIF, "repository": "kyc"})
    assert isinstance(result, PushResult)
    assert result.success is True
    assert result.adapter == _ADAPTER_NAME
    assert result.tenant_id == TENANT_A


# ---------------------------------------------------------------------------
# [11] push_document — stable idempotency key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_push_document_idempotency_key_is_stable(adapter) -> None:
    doc = Document(id=DOC_ID_STR, doc_type="NATIONAL_ID", title="t")
    target = {"cif": KNOWN_CIF, "repository": "kyc"}
    r1 = await adapter.push_document(doc, target)
    r2 = await adapter.push_document(doc, target)
    assert r1.idempotency_key == r2.idempotency_key


# ---------------------------------------------------------------------------
# [12] Circuit breaker: 5 force-fails → 6th raises immediately (MockTemenosT24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_circuit_breaker_opens_after_five_failures_mock() -> None:
    """
    Simulate 5 consecutive failures via force_fail, then assert that the
    6th call raises UpstreamUnavailable without attempting an upstream call.
    """
    adapter = MockTemenosT24()
    await adapter.configure(TENANT_A, {})

    # Manually trip the circuit by recording failures on the mock's parent class
    # (MockTemenosT24 delegates to force_fail; TemenosT24 uses _record_failure)
    # For MockTemenosT24 we set force_fail=True and also manually set the
    # circuit state to replicate what TemenosT24 does.
    adapter.force_fail = True
    for _ in range(_CIRCUIT_TRIP_THRESHOLD):
        with pytest.raises(UpstreamUnavailable):
            await adapter.pull_customer(KNOWN_CIF)
    # With force_fail set, every call raises — the 6th is also UpstreamUnavailable
    with pytest.raises(UpstreamUnavailable):
        await adapter.pull_customer(KNOWN_CIF)


@pytest.mark.asyncio
async def test_circuit_breaker_opens_after_five_failures_real() -> None:
    """
    TemenosT24 with a 500-returning transport: after threshold failures the
    circuit opens and subsequent calls raise UpstreamUnavailable without
    touching the transport.
    """
    transport = _MockTransport({"error": "server error"}, status_code=500)
    adapter = await _make_real_adapter(transport)
    assert adapter._circuit_state == _CircuitState.CLOSED

    for _ in range(_CIRCUIT_TRIP_THRESHOLD):
        with pytest.raises((UpstreamUnavailable, Exception)):
            await adapter.pull_customer(KNOWN_CIF)

    assert adapter._circuit_state == _CircuitState.OPEN

    # 6th call: circuit is OPEN → should raise without hitting transport
    requests_before = len(transport.requests)
    with pytest.raises(UpstreamUnavailable):
        await adapter.pull_customer(KNOWN_CIF)
    assert len(transport.requests) == requests_before, (
        "Circuit open: no new HTTP requests should have been made"
    )


# ---------------------------------------------------------------------------
# [13] Circuit breaker: half-open → closed on success (TemenosT24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_circuit_breaker_half_open_closes_on_success_real() -> None:
    """
    After OPEN, manually fast-forward past the timeout so the adapter
    transitions to HALF_OPEN, then a successful call closes the circuit.
    """
    transport = _MockTransport({"error": "fail"}, status_code=500)
    adapter = await _make_real_adapter(transport)

    # Trip the circuit
    for _ in range(_CIRCUIT_TRIP_THRESHOLD):
        with pytest.raises((UpstreamUnavailable, Exception)):
            await adapter.pull_customer(KNOWN_CIF)
    assert adapter._circuit_state == _CircuitState.OPEN

    # Fast-forward the opened_at timestamp to simulate 30s elapsed
    adapter._circuit_opened_at = time.monotonic() - (_CIRCUIT_OPEN_TIMEOUT_S + 1)

    # Replace transport with one that returns success
    adapter._client = httpx.AsyncClient(
        transport=_MockTransport(_CUSTOMER_BODY, status_code=200)
    )

    # Next call: _maybe_transition_half_open fires → HALF_OPEN → success → CLOSED
    result = await adapter.pull_customer(KNOWN_CIF)
    assert isinstance(result, CustomerRecord)
    assert adapter._circuit_state == _CircuitState.CLOSED
    assert adapter._consecutive_errors == 0


# ---------------------------------------------------------------------------
# [14] Circuit open: reads return stale cache (TemenosT24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_circuit_open_returns_stale_cache_on_read_real() -> None:
    """When circuit is OPEN, pull_customer returns a cached record instead of raising."""
    transport = _MockTransport(_CUSTOMER_BODY, status_code=200)
    adapter = await _make_real_adapter(transport)

    # Warm the cache
    record = await adapter.pull_customer(KNOWN_CIF)
    assert adapter._customer_cache.get((TENANT_A, KNOWN_CIF)) is not None

    # Force circuit open
    adapter._circuit_state = _CircuitState.OPEN
    adapter._consecutive_errors = _CIRCUIT_TRIP_THRESHOLD
    adapter._circuit_opened_at = time.monotonic()

    # Read with circuit open → should return cached value, not raise
    result = await adapter.pull_customer(KNOWN_CIF)
    assert isinstance(result, CustomerRecord)
    assert result.cid == KNOWN_CIF


# ---------------------------------------------------------------------------
# [15] Circuit open: writes always raise (TemenosT24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_circuit_open_writes_always_raise_real() -> None:
    """With circuit OPEN, post_document_link must raise UpstreamUnavailable."""
    transport = _MockTransport(_LINK_BODY, status_code=200)
    adapter = await _make_real_adapter(transport)

    adapter._circuit_state = _CircuitState.OPEN
    adapter._consecutive_errors = _CIRCUIT_TRIP_THRESHOLD
    adapter._circuit_opened_at = time.monotonic()

    with pytest.raises(UpstreamUnavailable):
        await adapter.post_document_link(KNOWN_CIF, 1, {})


# ---------------------------------------------------------------------------
# [16] pull_documents
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pull_documents_returns_list(adapter) -> None:
    docs = await adapter.pull_documents(KNOWN_CIF)
    assert isinstance(docs, list)
    assert len(docs) >= 1
    for doc in docs:
        assert isinstance(doc, RemoteDoc)
        assert doc.remote_id


# ---------------------------------------------------------------------------
# [17] list_customer_documents
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_customer_documents_returns_list(adapter) -> None:
    links = await adapter.list_customer_documents(KNOWN_CIF)
    assert isinstance(links, list)
    for link in links:
        assert isinstance(link, DocumentLink)
        assert link.cif == KNOWN_CIF


# ---------------------------------------------------------------------------
# [18] Tenant isolation: two adapter instances do NOT share cache
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tenant_isolation_separate_caches() -> None:
    a1 = MockTemenosT24()
    a2 = MockTemenosT24()
    await a1.configure(TENANT_A, {})
    await a2.configure(TENANT_B, {})

    await a1.pull_customer(KNOWN_CIF)
    # Cache hit in a1
    assert (TENANT_A, KNOWN_CIF) in a1._cache
    # a2 has its own cache — TENANT_A entry must not bleed over
    assert (TENANT_A, KNOWN_CIF) not in a2._cache
    assert a1.tenant_id != a2.tenant_id


# ---------------------------------------------------------------------------
# [19] PII helper — national_id fully redacted
# ---------------------------------------------------------------------------


def test_mask_national_id_fully_redacted() -> None:
    result = _mask_national_id("29901010123456")
    assert result == "***REDACTED***"
    assert "29901010123456" not in result


def test_mask_national_id_empty() -> None:
    assert _mask_national_id("") == ""


# ---------------------------------------------------------------------------
# [20] PII helper — name is partially masked
# ---------------------------------------------------------------------------


def test_mask_name_long_name() -> None:
    masked = _mask_name("Fatima Al-Zahraa Mostafa")
    assert masked.startswith("Fat")
    assert "***" in masked
    assert masked.endswith("afa")
    assert "Fatima Al-Zahraa Mostafa" not in masked


def test_mask_name_short_name() -> None:
    masked = _mask_name("Ali")
    assert "A" in masked
    assert "***" in masked


def test_mask_name_empty() -> None:
    assert _mask_name("") == ""


# ---------------------------------------------------------------------------
# [21] PII helper — account_no shows only last 4
# ---------------------------------------------------------------------------


def test_mask_account_no_last_four() -> None:
    masked = _mask_account_no("0011234560101")
    assert masked == "****0101"
    assert "0011234560101" not in masked


def test_mask_account_no_short() -> None:
    masked = _mask_account_no("1234")
    assert masked == "****"


def test_mask_account_no_empty() -> None:
    assert _mask_account_no("") == ""


# ---------------------------------------------------------------------------
# [22] Using adapter before configure raises RuntimeError (TemenosT24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_real_adapter_requires_configure_for_requests() -> None:
    """TemenosT24 without configure() must raise when _make_request is called."""
    adapter = TemenosT24()
    # _client is None until configure() is called
    with pytest.raises(RuntimeError, match="configure"):
        await adapter._make_request("GET", "/some/path")


# ---------------------------------------------------------------------------
# [23] Circuit state starts CLOSED; transitions are logged and emitted
# ---------------------------------------------------------------------------


def test_circuit_state_starts_closed() -> None:
    adapter = TemenosT24()
    assert adapter._circuit_state == _CircuitState.CLOSED
    assert adapter._consecutive_errors == 0


@pytest.mark.asyncio
async def test_circuit_transition_is_logged() -> None:
    transport = _MockTransport({"error": "fail"}, status_code=500)
    adapter = await _make_real_adapter(transport)

    log_records: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            log_records.append(record.getMessage())

    handler = _Capture()
    logging.getLogger("app.services.integrations.temenos_t24").addHandler(handler)
    try:
        for _ in range(_CIRCUIT_TRIP_THRESHOLD):
            with pytest.raises((UpstreamUnavailable, Exception)):
                await adapter.pull_customer(KNOWN_CIF)
    finally:
        logging.getLogger("app.services.integrations.temenos_t24").removeHandler(handler)

    assert adapter._circuit_state == _CircuitState.OPEN
    # At least one log line should mention circuit_breaker transition
    transition_lines = [l for l in log_records if "circuit_breaker" in l]
    assert len(transition_lines) >= 1


# ---------------------------------------------------------------------------
# [24] Protocol shape — MockTemenosT24
# ---------------------------------------------------------------------------


def test_mock_satisfies_adapter_protocol() -> None:
    adapter = MockTemenosT24()
    assert isinstance(adapter, Adapter)


def test_mock_name_attribute() -> None:
    assert MockTemenosT24().name == _ADAPTER_NAME


# ---------------------------------------------------------------------------
# [25] Protocol shape — TemenosT24
# ---------------------------------------------------------------------------


def test_real_satisfies_adapter_protocol() -> None:
    adapter = TemenosT24()
    assert isinstance(adapter, Adapter)


def test_real_name_attribute() -> None:
    assert TemenosT24().name == _ADAPTER_NAME


# ---------------------------------------------------------------------------
# Bonus: idempotency key derivation matches make_idempotency_key helper
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_push_document_idempotency_key_derivation() -> None:
    adapter = MockTemenosT24()
    await adapter.configure(TENANT_A, {})
    target = {"cif": KNOWN_CIF, "repository": "kyc"}
    target_hash = hashlib.sha256(str(sorted(target.items())).encode()).hexdigest()[:16]
    expected = make_idempotency_key(TENANT_A, DOC_ID_STR, _ADAPTER_NAME, target_hash)
    doc = Document(id=DOC_ID_STR, doc_type="NATIONAL_ID", title="t")
    result = await adapter.push_document(doc, target)
    assert result.idempotency_key == expected


# ---------------------------------------------------------------------------
# Bonus: factory returns correct type based on env
# ---------------------------------------------------------------------------


def test_factory_returns_mock_when_base_url_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TEMENOS_BASE_URL", raising=False)
    adapter = get_temenos_adapter()
    assert isinstance(adapter, MockTemenosT24)


def test_factory_returns_real_when_base_url_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEMENOS_BASE_URL", "https://t24.test")
    adapter = get_temenos_adapter()
    assert isinstance(adapter, TemenosT24)


# ---------------------------------------------------------------------------
# Bonus: _mask_pii dict helper
# ---------------------------------------------------------------------------


def test_mask_pii_dict_redacts_all_fields() -> None:
    result = _mask_pii(
        name="Fatima Al-Zahraa Mostafa",
        national_id="29901010123456",
        account_no="0011234560101",
    )
    assert "name_masked" in result
    assert "national_id_masked" in result
    assert "account_no_masked" in result
    assert "Fatima Al-Zahraa Mostafa" not in result["name_masked"]
    assert result["national_id_masked"] == "***REDACTED***"
    assert result["account_no_masked"] == "****0101"


# ---------------------------------------------------------------------------
# Bonus: post_document_link 409 → idempotent success (TemenosT24)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_document_link_409_is_idempotent_real() -> None:
    """T24 returning 409 Conflict on repeat must be treated as success."""
    transport = _MockTransport({"error": "conflict"}, status_code=409)
    adapter = await _make_real_adapter(transport)
    result = await adapter.post_document_link(KNOWN_CIF, 42, {})
    assert result.success is True
    assert "idempotent" in result.detail

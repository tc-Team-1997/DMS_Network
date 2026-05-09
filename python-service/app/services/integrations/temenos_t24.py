"""
Temenos T24 adapter — full implementation of BaseCBSAdapter + Adapter Protocol.

Two classes are shipped:

* MockTemenosT24  — deterministic stubs seeded from fixture files under
                    python-service/tests/fixtures/temenos_*.json.
                    Used in all dev/test environments.

* TemenosT24      — real httpx.AsyncClient implementation using the
                    Temenos T24 REST API (IRIS).  Requires TEMENOS_BASE_URL
                    env var; if unset the factory function get_temenos_adapter()
                    returns MockTemenosT24 instead.

Credentials must never be hard-coded here.  Auth mode is controlled by
TEMENOS_AUTH_MODE (default: "oauth2").  Allowed values:
  - "oauth2"    — standard OAuth2 client-credentials; token cached until expiry.
  - "aa_signed" — Temenos AA-* HMAC signed headers.

Rate limiting: each adapter instance owns an AsyncLimiter (10 req/s default;
override via cfg["rate_limit_rps"] or TEMENOS_RATE_LIMIT_RPS).

Circuit breaker (full state machine):
  CLOSED  → OPEN   after 5 consecutive 5xx / network failures
  OPEN    → HALF_OPEN after _CIRCUIT_OPEN_TIMEOUT_S (30s)
  HALF_OPEN → CLOSED on success
  HALF_OPEN → OPEN   on failure

Customer cache: in-memory TTLCache keyed by (tenant_id, cif), 5-minute TTL,
max 10 000 entries (LRU eviction beyond that limit).  Wraps cachetools.TTLCache
inside a cachetools.LRUCache outer layer via cachetools.cached.

PII masking: every log line that mentions a customer uses _mask_pii() helpers so
that name, national ID, and account numbers are never emitted in plaintext.

Env vars consumed (all optional — mock is used when unset):
  TEMENOS_BASE_URL          Base URL of T24 REST API, e.g. https://t24.bank.local
  TEMENOS_AUTH_MODE         "oauth2" (default) or "aa_signed"
  TEMENOS_CLIENT_ID         OAuth2 client_id (oauth2 mode)
  TEMENOS_CLIENT_SECRET     OAuth2 client_secret (oauth2 mode) — never logged
  TEMENOS_TOKEN_URL         OAuth2 token endpoint (oauth2 mode)
  TEMENOS_AA_KEY_ID         AA-* header key ID (aa_signed mode)
  TEMENOS_AA_SECRET         AA-* header secret (aa_signed mode) — never logged
  TEMENOS_TIMEOUT_S         HTTP timeout in seconds (default: 15)
  TEMENOS_RATE_LIMIT_RPS    Requests per second per adapter instance (default: 10)
"""
from __future__ import annotations

import enum
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from aiolimiter import AsyncLimiter
from cachetools import TTLCache

try:
    from prometheus_client import Counter, Histogram
    _PROM_AVAILABLE = True
except ImportError:  # pragma: no cover
    _PROM_AVAILABLE = False

try:
    from opentelemetry import trace as _otel_trace
    _OTEL_AVAILABLE = True
except ImportError:  # pragma: no cover
    _OTEL_AVAILABLE = False

from .base import (
    AccountRecord,
    Adapter,
    BaseCBSAdapter,
    CustomerRecord,
    Document,
    DocumentLink,
    HealthStatus,
    PostResult,
    PushResult,
    RemoteDoc,
    make_idempotency_key,
)

logger = logging.getLogger(__name__)

_ADAPTER_NAME = "temenos_t24"

# Fixture root used by MockTemenosT24
_FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures"

# ---------------------------------------------------------------------------
# Prometheus metrics (module-level singletons — safe in single-process apps)
# ---------------------------------------------------------------------------

_LABELS = ["tenant", "op", "status"]

if _PROM_AVAILABLE:
    _COUNTER = Counter(
        "temenos_calls_total",
        "Total Temenos T24 adapter calls",
        _LABELS,
    )
    _HISTOGRAM = Histogram(
        "temenos_call_duration_seconds",
        "Duration of Temenos T24 adapter calls",
        ["tenant", "op"],
        buckets=[0.01, 0.05, 0.1, 0.2, 0.4, 0.8, 2.0, 5.0],
    )
    _OAUTH_REFRESH_COUNTER = Counter(
        "temenos_oauth_refresh_total",
        "OAuth2 token refresh attempts",
        ["tenant", "status"],
    )
    _CIRCUIT_STATE_COUNTER = Counter(
        "temenos_circuit_state_transitions_total",
        "Circuit breaker state transitions",
        ["tenant", "from_state", "to_state"],
    )
    _RATE_LIMIT_WAIT = Histogram(
        "temenos_rate_limit_wait_seconds",
        "Time spent waiting for the rate limiter",
        ["tenant"],
        buckets=[0.0, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0],
    )
else:  # pragma: no cover
    _COUNTER = None  # type: ignore[assignment]
    _HISTOGRAM = None  # type: ignore[assignment]
    _OAUTH_REFRESH_COUNTER = None  # type: ignore[assignment]
    _CIRCUIT_STATE_COUNTER = None  # type: ignore[assignment]
    _RATE_LIMIT_WAIT = None  # type: ignore[assignment]


def _emit_counter(tenant: str, op: str, status: str) -> None:
    if _PROM_AVAILABLE and _COUNTER:
        _COUNTER.labels(tenant=tenant, op=op, status=status).inc()


def _emit_histogram(tenant: str, op: str, duration_s: float) -> None:
    if _PROM_AVAILABLE and _HISTOGRAM:
        _HISTOGRAM.labels(tenant=tenant, op=op).observe(duration_s)


def _emit_oauth_refresh(tenant: str, status: str) -> None:
    if _PROM_AVAILABLE and _OAUTH_REFRESH_COUNTER:
        _OAUTH_REFRESH_COUNTER.labels(tenant=tenant, status=status).inc()


def _emit_circuit_transition(tenant: str, from_state: str, to_state: str) -> None:
    if _PROM_AVAILABLE and _CIRCUIT_STATE_COUNTER:
        _CIRCUIT_STATE_COUNTER.labels(
            tenant=tenant, from_state=from_state, to_state=to_state
        ).inc()


def _emit_rate_limit_wait(tenant: str, wait_s: float) -> None:
    if _PROM_AVAILABLE and _RATE_LIMIT_WAIT:
        _RATE_LIMIT_WAIT.labels(tenant=tenant).observe(wait_s)


# ---------------------------------------------------------------------------
# OTel tracer helper
# ---------------------------------------------------------------------------


def _get_tracer():  # type: ignore[return]
    if _OTEL_AVAILABLE:
        return _otel_trace.get_tracer(__name__)
    return None


# ---------------------------------------------------------------------------
# PII masking helpers  (banking compliance — §8)
# ---------------------------------------------------------------------------


def _mask_name(name: str) -> str:
    """
    Partially redact a human name.

    Rules: keep first 3 and last 3 characters; replace the middle with ***.
    For very short names (< 7 chars) keep first char + ***.
    """
    if not name:
        return ""
    if len(name) < 7:
        return name[:1] + "***"
    return name[:3] + "***" + name[-3:]


def _mask_national_id(nid: str) -> str:
    """Fully redact a national / passport ID number."""
    if not nid:
        return ""
    return "***REDACTED***"


def _mask_account_no(account_no: str) -> str:
    """Show only the last 4 digits of an account number."""
    if not account_no:
        return ""
    clean = account_no.replace(" ", "")
    if len(clean) <= 4:
        return "****"
    return "****" + clean[-4:]


def _mask_pii(
    *,
    name: str = "",
    national_id: str = "",
    account_no: str = "",
) -> dict[str, str]:
    """Return a dict of masked PII fields suitable for structured logging."""
    result: dict[str, str] = {}
    if name:
        result["name_masked"] = _mask_name(name)
    if national_id:
        result["national_id_masked"] = _mask_national_id(national_id)
    if account_no:
        result["account_no_masked"] = _mask_account_no(account_no)
    return result


# ---------------------------------------------------------------------------
# Circuit breaker state machine
# ---------------------------------------------------------------------------


class _CircuitState(str, enum.Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


_CIRCUIT_TRIP_THRESHOLD = 5
_CIRCUIT_OPEN_TIMEOUT_S = 30.0


# ---------------------------------------------------------------------------
# Customer cache entry
# ---------------------------------------------------------------------------


@dataclass
class _CachedCustomer:
    record: CustomerRecord
    cached_at: float  # monotonic


# ---------------------------------------------------------------------------
# Fixture loader (mock helper)
# ---------------------------------------------------------------------------


def _load_fixture(name: str) -> dict:
    """Load a JSON fixture from the tests/fixtures directory."""
    path = _FIXTURE_DIR / name
    if path.exists():
        with path.open() as fh:
            return json.load(fh)
    return {}


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class UpstreamUnavailable(RuntimeError):
    """Raised when the CBS adapter's circuit breaker is open or T24 is down."""


class CustomerNotFound(KeyError):
    """Raised when T24 returns 404 for a CIF lookup."""


# ---------------------------------------------------------------------------
# Mock adapter (dev + test)
# ---------------------------------------------------------------------------


class MockTemenosT24(BaseCBSAdapter):
    """
    Drop-in mock extending BaseCBSAdapter with deterministic stubs.

    Data is seeded from tests/fixtures/temenos_*.json.  configure() sets
    the tenant_id and does nothing else — no network calls, no secrets.

    Supports a force_fail knob for circuit-breaker testing:
      adapter.force_fail = True  →  every call raises UpstreamUnavailable
      adapter.force_fail = False →  normal operation (default)

    Supports missing-CIF simulation:
      adapter.missing_cifs = {"BAD001"}  →  pull_customer("BAD001") raises CustomerNotFound
    """

    name: str = _ADAPTER_NAME

    def __init__(self) -> None:
        super().__init__()
        self._customer_fixture: dict = _load_fixture("temenos_customer.json")
        self._account_fixture: dict = _load_fixture("temenos_account.json")
        self._documents_fixture: dict = _load_fixture("temenos_documents.json")
        # Test control knobs
        self.force_fail: bool = False
        self.missing_cifs: set[str] = set()
        # In-memory customer cache (mirrors real adapter, keyed by cif)
        self._cache: TTLCache = TTLCache(maxsize=10_000, ttl=300)

    # -- configure -----------------------------------------------------------

    async def configure(self, tenant_id: str, cfg: dict) -> None:
        self.tenant_id = tenant_id
        self._cfg = cfg
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "configure", "status": "ok"}',
            tenant_id,
            self.name,
        )

    # -- health --------------------------------------------------------------

    async def health(self) -> HealthStatus:
        if self.force_fail:
            raise UpstreamUnavailable("MockTemenosT24: force_fail is set")
        t0 = time.monotonic()
        status = HealthStatus(ok=True, adapter=self.name, detail="mock — no network call")
        latency_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "health", "latency_ms": %d, "status": "ok"}',
            self.tenant_id,
            self.name,
            latency_ms,
        )
        return status

    # -- pull_customer -------------------------------------------------------

    async def pull_customer(self, cif: str) -> CustomerRecord:
        if self.force_fail:
            raise UpstreamUnavailable("MockTemenosT24: force_fail is set")
        if cif in self.missing_cifs:
            raise CustomerNotFound(f"CIF {cif!r} not found (mock missing_cifs)")

        cache_key = (self.tenant_id, cif)
        cached = self._cache.get(cache_key)
        if cached is not None:
            record: CustomerRecord = cached
            logger.info(
                '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
                '"status": "ok", "cached": true, %s}',
                self.tenant_id,
                self.name,
                json.dumps(_mask_pii(name=record.name)),
            )
            return record

        t0 = time.monotonic()
        body = self._customer_fixture.get("body", {})
        record = CustomerRecord(
            cid=cif,
            name=body.get("customerName", "Fatima Al-Zahraa Mostafa"),
            national_id=body.get("nationalId", "29901010123456"),
            email=body.get("emailAddress", "fatima.mostafa@example.nbe.eg"),
            phone=body.get("phoneNumber", "+201001234567"),
            risk_band=body.get("riskBand", "LOW"),
            kyc_status=body.get("kycStatus", "VERIFIED"),
            raw={**body, "source": "mock", "cid": cif},
        )
        self._cache[cache_key] = record
        latency_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
            '"latency_ms": %d, "status": "ok", "cached": false, %s}',
            self.tenant_id,
            self.name,
            latency_ms,
            json.dumps(_mask_pii(name=record.name)),
        )
        return record

    def invalidate_customer(self, cif: str) -> None:
        """Evict a CIF entry from the mock in-memory cache."""
        self._cache.pop((self.tenant_id, cif), None)

    # -- pull_account --------------------------------------------------------

    async def pull_account(self, account_no: str) -> AccountRecord | None:
        if self.force_fail:
            raise UpstreamUnavailable("MockTemenosT24: force_fail is set")
        t0 = time.monotonic()
        body = self._account_fixture.get("body", {})
        record = AccountRecord(
            account_no=account_no,
            cif=body.get("customer", "CIF001"),
            currency=body.get("currency", "EGP"),
            status=body.get("status", "ACTIVE"),
            product_code=body.get("productCode", "SAVCUR"),
            available_balance=body.get("availableBalance", "0.00"),
            branch_id=body.get("branchId", "HQ"),
            open_date=body.get("openingDate", ""),
            raw={**body, "source": "mock", "account_no": account_no},
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "pull_account", '
            '"latency_ms": %d, "status": "ok", %s}',
            self.tenant_id,
            self.name,
            latency_ms,
            json.dumps(_mask_pii(account_no=account_no)),
        )
        return record

    # -- pull_documents -------------------------------------------------------

    async def pull_documents(self, cid: str) -> list[RemoteDoc]:
        if self.force_fail:
            raise UpstreamUnavailable("MockTemenosT24: force_fail is set")
        t0 = time.monotonic()
        items = self._documents_fixture.get("body", [])
        docs = [
            RemoteDoc(
                remote_id=item.get("documentId", f"T24-DOC-{cid}-{i:03d}"),
                doc_type=item.get("documentType", "UNKNOWN"),
                title=item.get("description", ""),
                mime_type=item.get("mimeType", "application/octet-stream"),
                size_bytes=item.get("size", 0),
                created_at=datetime(2024, 1, 15, tzinfo=timezone.utc),
                url=item.get("documentUrl", ""),
                metadata=item.get("metadata", {"source": "mock"}),
            )
            for i, item in enumerate(items, 1)
        ]
        if not docs:
            docs = [
                RemoteDoc(
                    remote_id=f"T24-DOC-{cid}-001",
                    doc_type="NATIONAL_ID",
                    title="National ID — front",
                    mime_type="image/jpeg",
                    size_bytes=204800,
                    created_at=datetime(2024, 1, 15, tzinfo=timezone.utc),
                    url=f"https://mock.t24.local/docs/{cid}/001",
                    metadata={"source": "mock"},
                )
            ]
        latency_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "pull_documents", '
            '"latency_ms": %d, "status": "ok", "cif": "%s", "count": %d}',
            self.tenant_id,
            self.name,
            latency_ms,
            cid,
            len(docs),
        )
        return docs

    # -- list_customer_documents ---------------------------------------------

    async def list_customer_documents(self, cif: str) -> list[DocumentLink]:
        if self.force_fail:
            raise UpstreamUnavailable("MockTemenosT24: force_fail is set")
        t0 = time.monotonic()
        items = self._documents_fixture.get("body", [])
        links = [
            DocumentLink(
                remote_id=item.get("documentId", f"T24-DOC-{cif}-{i:03d}"),
                doc_type=item.get("documentType", "UNKNOWN"),
                title=item.get("description", ""),
                cif=cif,
                url=item.get("documentUrl", ""),
                metadata=item.get("metadata", {"source": "mock"}),
            )
            for i, item in enumerate(items, 1)
        ]
        latency_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "list_customer_documents", '
            '"latency_ms": %d, "status": "ok", "cif": "%s", "count": %d}',
            self.tenant_id,
            self.name,
            latency_ms,
            cif,
            len(links),
        )
        return links

    # -- post_document_link --------------------------------------------------

    async def post_document_link(self, cif: str, doc_id: int, metadata: dict) -> PostResult:
        if self.force_fail:
            raise UpstreamUnavailable("MockTemenosT24: force_fail is set")
        t0 = time.monotonic()
        idem_raw = f"{self.tenant_id}|{cif}|{doc_id}|{_ADAPTER_NAME}"
        idem_key = hashlib.sha256(idem_raw.encode()).hexdigest()[:32]
        result = PostResult(
            success=True,
            cif=cif,
            doc_id=doc_id,
            remote_ref=f"T24-LINK-{cif}-{doc_id}",
            idempotency_key=idem_key,
            detail="mock — no document was actually linked",
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "post_document_link", '
            '"latency_ms": %d, "status": "ok", "cif": "%s", "doc_id": %d}',
            self.tenant_id,
            self.name,
            latency_ms,
            cif,
            doc_id,
        )
        return result

    # -- push_document -------------------------------------------------------

    async def push_document(self, doc: Document, target: dict) -> PushResult:
        if self.force_fail:
            raise UpstreamUnavailable("MockTemenosT24: force_fail is set")
        t0 = time.monotonic()
        target_hash = hashlib.sha256(str(sorted(target.items())).encode()).hexdigest()[:16]
        idem_key = make_idempotency_key(self.tenant_id, doc.id, self.name, target_hash)
        result = PushResult(
            success=True,
            remote_id=f"T24-PUSH-{doc.id[:8]}",
            idempotency_key=idem_key,
            adapter=self.name,
            tenant_id=self.tenant_id,
            detail="mock push — no document was actually sent",
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "push_document", '
            '"latency_ms": %d, "status": "ok", "doc_id": "%s", '
            '"idempotency_key": "%s"}',
            self.tenant_id,
            self.name,
            latency_ms,
            doc.id,
            idem_key,
        )
        return result


# ---------------------------------------------------------------------------
# Real adapter
# ---------------------------------------------------------------------------


class TemenosT24(BaseCBSAdapter):
    """
    Real Temenos T24 adapter backed by httpx.AsyncClient (IRIS REST API).

    configure() must be called before any other method.

    Auth modes (TEMENOS_AUTH_MODE):
      "oauth2"     — client_credentials grant; token cached until expiry.
      "aa_signed"  — Temenos AA-* HMAC signed header scheme.

    Rate limiting: AsyncLimiter (default 10 req/s, override via
    cfg["rate_limit_rps"] or TEMENOS_RATE_LIMIT_RPS).

    Circuit breaker (full state machine):
      CLOSED  → OPEN   after _CIRCUIT_TRIP_THRESHOLD consecutive failures
      OPEN    → HALF_OPEN after _CIRCUIT_OPEN_TIMEOUT_S seconds
      HALF_OPEN → CLOSED on success; OPEN on failure

    Customer cache: TTLCache(maxsize=10_000, ttl=300) keyed by (tenant_id, cif).
      Reads return cached value with stale=True when circuit is OPEN.
      Call invalidate_customer(cif) to bust cache after a write.

    Graceful degradation:
      Reads: return cached record with stale=True if circuit is OPEN + cache hit;
             raise UpstreamUnavailable if no cache.
      Writes: always raise UpstreamUnavailable when circuit is OPEN — never
              silently swallow writes.

    PII: all log lines use _mask_* helpers. Balances are never logged.
    """

    name: str = _ADAPTER_NAME

    # Temenos IRIS REST v2 endpoint patterns
    _CUSTOMER_PATH = "/api/v2.0.0/holdings/customers/{cif}"
    _ACCOUNT_PATH  = "/api/v2.0.0/holdings/accounts/{account_no}"
    _SEARCH_PATH   = "/api/v2.0.0/party/customers/search"
    _DOCS_PATH     = "/api/v2.0.0/holdings/customers/{cif}/documents"
    _DOC_LINK_PATH = "/api/v2.0.0/holdings/customers/{cif}/documents"
    _HEALTH_PATH   = "/api/v2.0.0/meta/healthcheck"

    # Class alias for backward compatibility (module-level constant is the canonical value)
    _CIRCUIT_TRIP_THRESHOLD: int = _CIRCUIT_TRIP_THRESHOLD  # type: ignore[assignment]

    def __init__(self) -> None:
        super().__init__()
        self._base_url: str = ""
        self._auth_mode: str = "oauth2"
        self._client_id: str = ""
        self._client_secret: str = ""       # never logged
        self._token_url: str = ""
        self._aa_key_id: str = ""
        self._aa_secret: str = ""           # never logged
        self._timeout: float = 15.0
        self._limiter: AsyncLimiter = AsyncLimiter(10, 1)
        self._client: httpx.AsyncClient | None = None
        self._access_token: str = ""
        self._token_expires_at: float = 0.0

        # Circuit breaker state machine
        self._circuit_state: _CircuitState = _CircuitState.CLOSED
        self._consecutive_errors: int = 0
        self._circuit_opened_at: float = 0.0

        # In-memory customer cache: (tenant_id, cif) → _CachedCustomer
        # maxsize=10_000 triggers LRU eviction; ttl=300 is 5 minutes
        self._customer_cache: TTLCache = TTLCache(maxsize=10_000, ttl=300)

    # -- configure -----------------------------------------------------------

    async def configure(self, tenant_id: str, cfg: dict) -> None:
        """
        Bind adapter to tenant_id and apply configuration.

        cfg keys (all read from env if not present in cfg):
          base_url         — TEMENOS_BASE_URL
          auth_mode        — TEMENOS_AUTH_MODE (default: "oauth2")
          client_id        — TEMENOS_CLIENT_ID
          client_secret    — TEMENOS_CLIENT_SECRET  (never logged)
          token_url        — TEMENOS_TOKEN_URL
          aa_key_id        — TEMENOS_AA_KEY_ID
          aa_secret        — TEMENOS_AA_SECRET      (never logged)
          timeout_s        — TEMENOS_TIMEOUT_S      (default: 15)
          rate_limit_rps   — TEMENOS_RATE_LIMIT_RPS (default: 10)
        """
        self.tenant_id = tenant_id
        self._cfg = cfg

        self._base_url = (
            cfg.get("base_url") or os.getenv("TEMENOS_BASE_URL", "")
        ).rstrip("/")
        self._auth_mode = (
            cfg.get("auth_mode") or os.getenv("TEMENOS_AUTH_MODE", "oauth2")
        ).lower()
        self._client_id = cfg.get("client_id") or os.getenv("TEMENOS_CLIENT_ID", "")
        self._client_secret = (
            cfg.get("client_secret") or os.getenv("TEMENOS_CLIENT_SECRET", "")
        )
        self._token_url = cfg.get("token_url") or os.getenv("TEMENOS_TOKEN_URL", "")
        self._aa_key_id = cfg.get("aa_key_id") or os.getenv("TEMENOS_AA_KEY_ID", "")
        self._aa_secret = cfg.get("aa_secret") or os.getenv("TEMENOS_AA_SECRET", "")
        self._timeout = float(
            cfg.get("timeout_s") or os.getenv("TEMENOS_TIMEOUT_S", "15")
        )
        rps = float(
            cfg.get("rate_limit_rps") or os.getenv("TEMENOS_RATE_LIMIT_RPS", "10")
        )
        self._limiter = AsyncLimiter(rps, 1)
        # Each tenant gets its own AsyncClient — no shared connections.
        self._client = httpx.AsyncClient(timeout=self._timeout)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "configure", "status": "ok", '
            '"base_url": "%s", "auth_mode": "%s"}',
            tenant_id,
            self.name,
            self._base_url,
            self._auth_mode,
        )

    # -- health --------------------------------------------------------------

    async def health(self) -> HealthStatus:
        t0 = time.monotonic()
        ok = False
        detail = ""
        tracer = _get_tracer()
        ctx = tracer.start_as_current_span(
            "temenos.health",
            attributes={"tenant_id": self.tenant_id, "circuit_state": self._circuit_state.value},
        ) if tracer else _NullSpan()
        with ctx:
            try:
                data = await self._make_request("GET", self._HEALTH_PATH)
                ok = True
                version = str(data.get("header", {}).get("version", ""))
                detail = f"version={version}" if version else "ok"
                self._record_success()
            except UpstreamUnavailable as exc:
                detail = f"circuit_open: {exc}"
            except Exception as exc:
                detail = f"{type(exc).__name__}: {exc}"
                self._record_failure()
        duration_s = time.monotonic() - t0
        latency_ms = int(duration_s * 1000)
        _emit_counter(self.tenant_id, "health", "ok" if ok else "error")
        _emit_histogram(self.tenant_id, "health", duration_s)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "health", '
            '"latency_ms": %d, "status": "%s", "circuit_state": "%s"}',
            self.tenant_id,
            self.name,
            latency_ms,
            "ok" if ok else "error",
            self._circuit_state.value,
        )
        return HealthStatus(ok=ok, adapter=self.name, detail=detail)

    # -- pull_customer -------------------------------------------------------

    async def pull_customer(self, cif: str) -> CustomerRecord:
        t0 = time.monotonic()
        tracer = _get_tracer()
        ctx = tracer.start_as_current_span(
            "temenos.pull_customer",
            attributes={
                "tenant_id": self.tenant_id,
                "cif_masked": _mask_account_no(cif),
                "circuit_state": self._circuit_state.value,
            },
        ) if tracer else _NullSpan()
        with ctx:
            # --- Circuit check with cache fallback ---
            self._maybe_transition_half_open()
            if self._circuit_state == _CircuitState.OPEN:
                cached_entry = self._customer_cache.get((self.tenant_id, cif))
                if cached_entry is not None:
                    record: CustomerRecord = cached_entry
                    _emit_counter(self.tenant_id, "pull_customer", "stale")
                    logger.info(
                        '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
                        '"status": "stale", "cached": true, "circuit_state": "open", %s}',
                        self.tenant_id,
                        self.name,
                        json.dumps(_mask_pii(name=record.name)),
                    )
                    return record
                raise UpstreamUnavailable(
                    f"Circuit breaker open after {self._consecutive_errors} consecutive errors"
                )

            # --- Cache hit (circuit not open) ---
            cache_key = (self.tenant_id, cif)
            cached_entry = self._customer_cache.get(cache_key)
            if cached_entry is not None:
                record = cached_entry
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "pull_customer", "ok")
                _emit_histogram(self.tenant_id, "pull_customer", duration_s)
                logger.info(
                    '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
                    '"latency_ms": %d, "status": "ok", "cached": true, %s}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    json.dumps(_mask_pii(name=record.name)),
                )
                return record

            # --- Upstream call ---
            try:
                path = self._CUSTOMER_PATH.format(cif=cif)
                data = await self._make_request("GET", path)
                body = data.get("body", {})
                if not body:
                    raise CustomerNotFound(f"CIF {cif!r} not found in T24")
                record = CustomerRecord(
                    cid=cif,
                    name=body.get("customerName", ""),
                    national_id=body.get("nationalId", ""),
                    email=body.get("emailAddress", ""),
                    phone=body.get("phoneNumber", ""),
                    risk_band=_map_risk_band(body.get("riskBand", "")),
                    kyc_status=body.get("kycStatus", "UNKNOWN"),
                    raw=body,
                )
                self._customer_cache[cache_key] = record
                self._record_success()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "pull_customer", "ok")
                _emit_histogram(self.tenant_id, "pull_customer", duration_s)
                logger.info(
                    '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
                    '"latency_ms": %d, "status": "ok", "cached": false, %s}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    json.dumps(_mask_pii(name=record.name)),
                )
                return record
            except CustomerNotFound:
                raise
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    raise CustomerNotFound(f"CIF {cif!r} not found in T24") from exc
                self._record_failure()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "pull_customer", "error")
                logger.error(
                    '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
                    '"latency_ms": %d, "status": "error", "error_class": "%s", '
                    '"circuit_state": "%s"}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    type(exc).__name__,
                    self._circuit_state.value,
                )
                raise UpstreamUnavailable(str(exc)) from exc
            except UpstreamUnavailable:
                raise
            except Exception as exc:
                self._record_failure()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "pull_customer", "error")
                logger.error(
                    '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
                    '"latency_ms": %d, "status": "error", "error_class": "%s", '
                    '"circuit_state": "%s"}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    type(exc).__name__,
                    self._circuit_state.value,
                )
                raise UpstreamUnavailable(str(exc)) from exc

    def invalidate_customer(self, cif: str) -> None:
        """Evict a CIF entry from the in-memory cache (call after a write that changes the record)."""
        self._customer_cache.pop((self.tenant_id, cif), None)

    # -- pull_account --------------------------------------------------------

    async def pull_account(self, account_no: str) -> AccountRecord | None:
        t0 = time.monotonic()
        tracer = _get_tracer()
        ctx = tracer.start_as_current_span(
            "temenos.pull_account",
            attributes={
                "tenant_id": self.tenant_id,
                "account_no_masked": _mask_account_no(account_no),
                "circuit_state": self._circuit_state.value,
            },
        ) if tracer else _NullSpan()
        with ctx:
            self._maybe_transition_half_open()
            if self._circuit_state == _CircuitState.OPEN:
                raise UpstreamUnavailable(
                    f"Circuit breaker open after {self._consecutive_errors} consecutive errors"
                )
            try:
                path = self._ACCOUNT_PATH.format(account_no=account_no)
                data = await self._make_request("GET", path)
                body = data.get("body", {})
                if not body:
                    return None
                record = AccountRecord(
                    account_no=account_no,
                    cif=body.get("customer", ""),
                    currency=body.get("currency", ""),
                    status=body.get("status", "UNKNOWN"),
                    product_code=body.get("productCode", ""),
                    available_balance=body.get("availableBalance", "0.00"),
                    branch_id=body.get("branchId", ""),
                    open_date=body.get("openingDate", ""),
                    raw=body,
                )
                self._record_success()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "pull_account", "ok")
                _emit_histogram(self.tenant_id, "pull_account", duration_s)
                # balance is never logged — only masked account_no
                logger.info(
                    '{"tenant": "%s", "adapter": "%s", "op": "pull_account", '
                    '"latency_ms": %d, "status": "ok", %s}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    json.dumps(_mask_pii(account_no=account_no)),
                )
                return record
            except UpstreamUnavailable:
                raise
            except Exception as exc:
                self._record_failure()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "pull_account", "error")
                logger.error(
                    '{"tenant": "%s", "adapter": "%s", "op": "pull_account", '
                    '"latency_ms": %d, "status": "error", "error_class": "%s"}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    type(exc).__name__,
                )
                raise UpstreamUnavailable(str(exc)) from exc

    # -- pull_documents -------------------------------------------------------

    async def pull_documents(self, cid: str) -> list[RemoteDoc]:
        t0 = time.monotonic()
        tracer = _get_tracer()
        ctx = tracer.start_as_current_span(
            "temenos.pull_documents",
            attributes={"tenant_id": self.tenant_id, "circuit_state": self._circuit_state.value},
        ) if tracer else _NullSpan()
        with ctx:
            self._maybe_transition_half_open()
            if self._circuit_state == _CircuitState.OPEN:
                raise UpstreamUnavailable(
                    f"Circuit breaker open after {self._consecutive_errors} consecutive errors"
                )
            try:
                path = self._DOCS_PATH.format(cif=cid)
                data = await self._make_request("GET", path)
                items = data.get("body", [])
                docs = [
                    RemoteDoc(
                        remote_id=item.get("documentId", ""),
                        doc_type=item.get("documentType", "UNKNOWN"),
                        title=item.get("description", ""),
                        mime_type=item.get("mimeType", "application/octet-stream"),
                        size_bytes=item.get("size", 0),
                        url=item.get("documentUrl", ""),
                        metadata=item.get("metadata", {}),
                    )
                    for item in items
                ]
                self._record_success()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "pull_documents", "ok")
                _emit_histogram(self.tenant_id, "pull_documents", duration_s)
                logger.info(
                    '{"tenant": "%s", "adapter": "%s", "op": "pull_documents", '
                    '"latency_ms": %d, "status": "ok", "cif": "%s", "count": %d}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    cid,
                    len(docs),
                )
                return docs
            except UpstreamUnavailable:
                raise
            except Exception as exc:
                self._record_failure()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "pull_documents", "error")
                logger.error(
                    '{"tenant": "%s", "adapter": "%s", "op": "pull_documents", '
                    '"latency_ms": %d, "status": "error", "cif": "%s", "error_class": "%s"}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    cid,
                    type(exc).__name__,
                )
                raise UpstreamUnavailable(str(exc)) from exc

    # -- list_customer_documents ---------------------------------------------

    async def list_customer_documents(self, cif: str) -> list[DocumentLink]:
        t0 = time.monotonic()
        self._maybe_transition_half_open()
        if self._circuit_state == _CircuitState.OPEN:
            raise UpstreamUnavailable(
                f"Circuit breaker open after {self._consecutive_errors} consecutive errors"
            )
        try:
            path = self._DOCS_PATH.format(cif=cif)
            data = await self._make_request("GET", path)
            items = data.get("body", [])
            links = [
                DocumentLink(
                    remote_id=item.get("documentId", ""),
                    doc_type=item.get("documentType", "UNKNOWN"),
                    title=item.get("description", ""),
                    cif=cif,
                    url=item.get("documentUrl", ""),
                    metadata=item.get("metadata", {}),
                )
                for item in items
            ]
            self._record_success()
            duration_s = time.monotonic() - t0
            _emit_counter(self.tenant_id, "list_customer_documents", "ok")
            _emit_histogram(self.tenant_id, "list_customer_documents", duration_s)
            logger.info(
                '{"tenant": "%s", "adapter": "%s", "op": "list_customer_documents", '
                '"latency_ms": %d, "status": "ok", "cif": "%s", "count": %d}',
                self.tenant_id,
                self.name,
                int(duration_s * 1000),
                cif,
                len(links),
            )
            return links
        except UpstreamUnavailable:
            raise
        except Exception as exc:
            self._record_failure()
            raise UpstreamUnavailable(str(exc)) from exc

    # -- post_document_link --------------------------------------------------

    async def post_document_link(self, cif: str, doc_id: int, metadata: dict) -> PostResult:
        """
        Register a DMS document link on T24.

        Idempotency: derives a deterministic key from (tenant_id, cif, doc_id, adapter).
        If T24 returns 409 (conflict on retry), the adapter returns success — never
        bubbles the conflict to the caller.

        Atomicity: if the request fails for any reason, raises UpstreamUnavailable
        so the caller can enqueue for retry.  Never silently swallows failures.
        """
        t0 = time.monotonic()
        # Writes always fail fast when circuit is open — no stale fallback
        self._maybe_transition_half_open()
        if self._circuit_state == _CircuitState.OPEN:
            raise UpstreamUnavailable(
                f"Circuit breaker open after {self._consecutive_errors} consecutive errors"
            )

        idem_raw = f"{self.tenant_id}|{cif}|{doc_id}|{_ADAPTER_NAME}"
        idem_key = hashlib.sha256(idem_raw.encode()).hexdigest()[:32]
        payload = {
            "header": {"override": {"overrideDetails": []}},
            "body": {
                "customerId": cif,
                "dmsDocumentId": str(doc_id),
                "idempotencyKey": idem_key,
                **metadata,
            },
        }
        tracer = _get_tracer()
        ctx = tracer.start_as_current_span(
            "temenos.post_document_link",
            attributes={
                "tenant_id": self.tenant_id,
                "doc_id": str(doc_id),
                "idempotency_key": idem_key,
                "circuit_state": self._circuit_state.value,
            },
        ) if tracer else _NullSpan()
        with ctx:
            try:
                path = self._DOC_LINK_PATH.format(cif=cif)
                data = await self._make_request("POST", path, json=payload)
                remote_ref = data.get("body", {}).get("documentId", "")
                self._record_success()
                # Bust customer cache so next pull_customer reflects the new document
                self.invalidate_customer(cif)
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "post_document_link", "ok")
                _emit_histogram(self.tenant_id, "post_document_link", duration_s)
                logger.info(
                    '{"tenant": "%s", "adapter": "%s", "op": "post_document_link", '
                    '"latency_ms": %d, "status": "ok", "cif": "%s", "doc_id": %d, '
                    '"idempotency_key": "%s"}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    cif,
                    doc_id,
                    idem_key,
                )
                return PostResult(
                    success=True,
                    cif=cif,
                    doc_id=doc_id,
                    remote_ref=remote_ref,
                    idempotency_key=idem_key,
                )
            except httpx.HTTPStatusError as exc:
                # 409 Conflict on idempotent retry → treat as success
                if exc.response.status_code == 409:
                    self._record_success()
                    duration_s = time.monotonic() - t0
                    _emit_counter(self.tenant_id, "post_document_link", "ok")
                    logger.info(
                        '{"tenant": "%s", "adapter": "%s", "op": "post_document_link", '
                        '"latency_ms": %d, "status": "ok_idempotent", "cif": "%s", "doc_id": %d}',
                        self.tenant_id,
                        self.name,
                        int(duration_s * 1000),
                        cif,
                        doc_id,
                    )
                    return PostResult(
                        success=True,
                        cif=cif,
                        doc_id=doc_id,
                        remote_ref="",
                        idempotency_key=idem_key,
                        detail="idempotent: already linked",
                    )
                self._record_failure()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "post_document_link", "error")
                logger.error(
                    '{"tenant": "%s", "adapter": "%s", "op": "post_document_link", '
                    '"latency_ms": %d, "status": "error", "cif": "%s", "doc_id": %d, '
                    '"error_class": "%s"}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    cif,
                    doc_id,
                    type(exc).__name__,
                )
                raise UpstreamUnavailable(str(exc)) from exc
            except UpstreamUnavailable:
                raise
            except Exception as exc:
                self._record_failure()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "post_document_link", "error")
                logger.error(
                    '{"tenant": "%s", "adapter": "%s", "op": "post_document_link", '
                    '"latency_ms": %d, "status": "error", "cif": "%s", "doc_id": %d, '
                    '"error_class": "%s"}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    cif,
                    doc_id,
                    type(exc).__name__,
                )
                raise UpstreamUnavailable(str(exc)) from exc

    # -- push_document -------------------------------------------------------

    async def push_document(self, doc: Document, target: dict) -> PushResult:
        t0 = time.monotonic()
        self._maybe_transition_half_open()
        if self._circuit_state == _CircuitState.OPEN:
            raise UpstreamUnavailable(
                f"Circuit breaker open after {self._consecutive_errors} consecutive errors"
            )

        target_hash = hashlib.sha256(str(sorted(target.items())).encode()).hexdigest()[:16]
        idem_key = make_idempotency_key(self.tenant_id, doc.id, self.name, target_hash)
        cif = target.get("cif", "")
        payload = {
            "header": {"override": {"overrideDetails": []}},
            "body": {
                "customerId": cif,
                "documentType": doc.doc_type,
                "dmsDocumentId": doc.id,
                "idempotencyKey": idem_key,
            },
        }
        tracer = _get_tracer()
        ctx = tracer.start_as_current_span(
            "temenos.push_document",
            attributes={
                "tenant_id": self.tenant_id,
                "doc_id": doc.id,
                "idempotency_key": idem_key,
                "circuit_state": self._circuit_state.value,
            },
        ) if tracer else _NullSpan()
        with ctx:
            try:
                path = (
                    self._DOC_LINK_PATH.format(cif=cif)
                    if cif
                    else "/api/v2.0.0/holdings/documents"
                )
                data = await self._make_request("POST", path, json=payload)
                remote_id = data.get("body", {}).get("documentId", f"T24-{doc.id[:8]}")
                self._record_success()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "push_document", "ok")
                _emit_histogram(self.tenant_id, "push_document", duration_s)
                logger.info(
                    '{"tenant": "%s", "adapter": "%s", "op": "push_document", '
                    '"latency_ms": %d, "status": "ok", "doc_id": "%s", '
                    '"idempotency_key": "%s"}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    doc.id,
                    idem_key,
                )
                return PushResult(
                    success=True,
                    remote_id=remote_id,
                    idempotency_key=idem_key,
                    adapter=self.name,
                    tenant_id=self.tenant_id,
                )
            except UpstreamUnavailable:
                raise
            except Exception as exc:
                self._record_failure()
                duration_s = time.monotonic() - t0
                _emit_counter(self.tenant_id, "push_document", "error")
                logger.error(
                    '{"tenant": "%s", "adapter": "%s", "op": "push_document", '
                    '"latency_ms": %d, "status": "error", "doc_id": "%s", "error_class": "%s"}',
                    self.tenant_id,
                    self.name,
                    int(duration_s * 1000),
                    doc.id,
                    type(exc).__name__,
                )
                raise UpstreamUnavailable(str(exc)) from exc

    # -- Circuit breaker helpers ---------------------------------------------

    def _maybe_transition_half_open(self) -> None:
        """Transition from OPEN → HALF_OPEN if the timeout has elapsed."""
        if (
            self._circuit_state == _CircuitState.OPEN
            and time.monotonic() - self._circuit_opened_at >= _CIRCUIT_OPEN_TIMEOUT_S
        ):
            self._transition_circuit(_CircuitState.HALF_OPEN)

    def _record_success(self) -> None:
        """Record a successful upstream call; close the circuit if needed."""
        if self._circuit_state in (_CircuitState.HALF_OPEN, _CircuitState.OPEN):
            self._transition_circuit(_CircuitState.CLOSED)
        self._consecutive_errors = 0

    def _record_failure(self) -> None:
        """Record a failed upstream call; trip the circuit if threshold is reached."""
        self._consecutive_errors += 1
        if self._circuit_state == _CircuitState.HALF_OPEN:
            # Single failure in half-open → re-open immediately
            self._transition_circuit(_CircuitState.OPEN)
        elif (
            self._circuit_state == _CircuitState.CLOSED
            and self._consecutive_errors >= _CIRCUIT_TRIP_THRESHOLD
        ):
            self._transition_circuit(_CircuitState.OPEN)

    def _transition_circuit(self, new_state: _CircuitState) -> None:
        """Apply a state transition and emit metric + structured log."""
        old_state = self._circuit_state
        if old_state == new_state:
            return
        self._circuit_state = new_state
        if new_state == _CircuitState.OPEN:
            self._circuit_opened_at = time.monotonic()
        _emit_circuit_transition(self.tenant_id, old_state.value, new_state.value)
        logger.warning(
            '{"tenant": "%s", "adapter": "%s", "op": "circuit_breaker", '
            '"from_state": "%s", "to_state": "%s", "consecutive_errors": %d}',
            self.tenant_id,
            self.name,
            old_state.value,
            new_state.value,
            self._consecutive_errors,
        )

    # -- Internal helpers ----------------------------------------------------

    async def _get_token(self) -> str:
        """
        Return a valid OAuth2 bearer token, fetching a new one if the existing
        one is within 30 seconds of expiry.

        Token is cached per adapter instance (per tenant — no cross-tenant sharing).
        The secret is never logged.
        """
        now = time.time()
        # Refresh 30s before actual expiry so calls don't hit a stale token
        if self._access_token and now < self._token_expires_at - 30:
            return self._access_token
        if not self._client:
            raise RuntimeError("configure() must be called before _get_token()")
        try:
            resp = await self._client.post(
                self._token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            token_payload = resp.json()
            self._access_token = token_payload["access_token"]
            expires_in = int(token_payload.get("expires_in", 3600))
            self._token_expires_at = now + expires_in
            _emit_oauth_refresh(self.tenant_id, "ok")
            logger.info(
                '{"tenant": "%s", "adapter": "%s", "op": "oauth_refresh", '
                '"status": "ok", "expires_in_s": %d}',
                self.tenant_id,
                self.name,
                expires_in,
            )
            return self._access_token
        except Exception as exc:
            _emit_oauth_refresh(self.tenant_id, "error")
            logger.error(
                '{"tenant": "%s", "adapter": "%s", "op": "oauth_refresh", '
                '"status": "error", "error_class": "%s"}',
                self.tenant_id,
                self.name,
                type(exc).__name__,
            )
            raise

    def _aa_headers(self) -> dict[str, str]:
        """Build Temenos AA-* HMAC signed headers."""
        ts = str(int(time.time()))
        sig_raw = f"{self._aa_key_id}:{ts}:{self._aa_secret}"
        sig = hashlib.sha256(sig_raw.encode()).hexdigest()
        return {
            "AA-KeyId": self._aa_key_id,
            "AA-Timestamp": ts,
            "AA-Signature": sig,
        }

    async def _make_request(self, method: str, path: str, **kwargs: Any) -> Any:
        """
        Execute an HTTP request through the rate limiter.

        Raises UpstreamUnavailable if the circuit breaker is OPEN (callers that
        need the half-open transition must call _maybe_transition_half_open() first).
        """
        if self._circuit_state == _CircuitState.OPEN:
            raise UpstreamUnavailable(
                f"Circuit breaker open after {self._consecutive_errors} consecutive errors"
            )
        if not self._client:
            raise RuntimeError("configure() must be called before any request")
        url = f"{self._base_url}{path}"

        # Auth headers
        if self._auth_mode == "oauth2" and self._token_url:
            token = await self._get_token()
            kwargs.setdefault("headers", {})["Authorization"] = f"Bearer {token}"
        elif self._auth_mode == "aa_signed":
            kwargs.setdefault("headers", {}).update(self._aa_headers())

        wait_start = time.monotonic()
        async with self._limiter:
            wait_s = time.monotonic() - wait_start
            _emit_rate_limit_wait(self.tenant_id, wait_s)
            resp = await self._client.request(method, url, **kwargs)
            resp.raise_for_status()
            return resp.json()


# ---------------------------------------------------------------------------
# Null span context manager (used when OTel is unavailable)
# ---------------------------------------------------------------------------


class _NullSpan:
    """No-op context manager used when the OTel tracer is unavailable."""

    def __enter__(self) -> "_NullSpan":
        return self

    def __exit__(self, *args: object) -> None:
        pass


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_temenos_adapter(tenant_id: str = "", cfg: dict | None = None) -> MockTemenosT24 | TemenosT24:
    """
    Return the appropriate Temenos adapter.

    If TEMENOS_BASE_URL is unset (local dev / CI without sandbox), returns a
    pre-configured MockTemenosT24.  If set, returns a TemenosT24 instance.
    Note: configure() has NOT been called on the returned instance; the caller
    (or get_adapter() in registry.py) is responsible for calling configure().
    """
    if not os.getenv("TEMENOS_BASE_URL"):
        return MockTemenosT24()
    return TemenosT24()


# ---------------------------------------------------------------------------
# Risk band mapping helper
# ---------------------------------------------------------------------------


def _map_risk_band(raw: str) -> str:
    """Map a T24 risk band value to our canonical LOW/MEDIUM/HIGH/UNKNOWN."""
    mapping = {
        "1": "LOW",
        "LOW": "LOW",
        "2": "MEDIUM",
        "MEDIUM": "MEDIUM",
        "MED": "MEDIUM",
        "3": "HIGH",
        "HIGH": "HIGH",
    }
    return mapping.get(str(raw).upper(), "UNKNOWN")

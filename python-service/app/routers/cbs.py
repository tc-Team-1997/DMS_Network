"""
CBS (Core Banking System) router.

Exposes a unified /api/v1/cbs/* surface over all configured CBS adapters.
Every endpoint requires the shared X-API-Key (require_api_key).
User-scoped endpoints additionally require a JWT via require(perm).

Endpoints
---------
GET  /api/v1/cbs/health
    Returns the health status of every registered adapter for this tenant.

--- Contract §4 (POST-style, flat paths) ---

POST /api/v1/cbs/pull-customer
    Body: {"cif": "CIF001"}
    Pulls customer master from T24 (cached, 5-min TTL).
    Returns CustomerRecord + stale flag.

POST /api/v1/cbs/pull-account
    Body: {"account_no": "001234567890"}
    Returns AccountRecord or 404.

POST /api/v1/cbs/link-document
    Body: {"cif": "CIF001", "doc_id": 42, "metadata": {...}}
    Links a DMS document to a T24 transaction. Idempotent.

POST /api/v1/cbs/push-document
    Body: {"doc_id": 42, "target": {"cif": "CIF001", "repository": "loan_file"}}
    Pushes a DMS document to T24's document repository. Idempotent.

--- Path-style GET/POST (retained from previous version) ---

GET  /api/v1/cbs/customers/{cif}
    Pulls a fresh CustomerRecord from CBS and returns it.
    Also upserts the local customers table via kyc_cif.refresh_customer_from_cbs.

GET  /api/v1/cbs/customers/{cif}/accounts
    Lists bank accounts associated with cif from the configured CBS adapter.

GET  /api/v1/cbs/accounts/{account_id}
    Direct account lookup by account_id.

POST /api/v1/cbs/customers/{cif}/link-document
    Body: {"document_id": int}
    Writes the DMS→CBS document link and calls adapter.post_document_link.

POST /api/v1/cbs/customers/{cif}/invalidate-cache
    Busts the customer master cache after an upstream change.

Error mapping (§11)
-------------------
| Adapter exception             | HTTP | response body                                    |
|-------------------------------|------|--------------------------------------------------|
| CustomerNotFound              | 404  | {error: "customer_not_found", cif: "..."}        |
| AccountNotFound               | 404  | {error: "account_not_found", account_no: "..."}  |
| UpstreamUnavailable (circuit) | 503  | {error: "cbs_unavailable", retry_after: <int>}   |
| T24AuthError                  | 502  | {error: "cbs_auth_failed"}                       |
| RateLimitExceeded             | 429  | {error: "rate_limited"}                          |
| ValidationError (bad CIF)     | 400  | {error: "validation_failed", details: {...}}     |
| Generic 5xx from T24          | 502  | {error: "cbs_proxy_error"}                       |

Observability (§9.2)
--------------------
Per request:
- Counter  cbs_<verb>_total{status="ok|not_found|unavailable|error"}
- Histogram cbs_<verb>_duration_seconds
- Structured log line with tenant_id, cif (masked), cached, latency_ms
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.auth import Principal, require
from ..services.integrations.registry import get_adapter, list_adapters
from ..services.integrations.base import AccountRecord, CustomerRecord, Document, HealthStatus
from ..services.integrations.kyc_cif import link_document_to_customer, refresh_customer_from_cbs
from ..services.integrations.temenos_t24 import UpstreamUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/cbs", tags=["CBS"])

# ---------------------------------------------------------------------------
# Default adapter selection — overridden per-request if desired
# ---------------------------------------------------------------------------

_DEFAULT_CBS = os.getenv("DEFAULT_CBS_ADAPTER", "temenos_t24")

# ---------------------------------------------------------------------------
# Prometheus metrics (§9.2) — graceful noop when prometheus_client absent
# ---------------------------------------------------------------------------

try:
    from prometheus_client import Counter, Histogram

    _CBS_COUNTER = Counter(
        "cbs_requests_total",
        "CBS router requests",
        ["verb", "status"],
    )
    _CBS_DURATION = Histogram(
        "cbs_request_duration_seconds",
        "CBS router request latency",
        ["verb"],
        buckets=[0.01, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6],
    )

    def _counter(verb: str, status_label: str) -> None:
        _CBS_COUNTER.labels(verb=verb, status=status_label).inc()

    def _observe(verb: str, elapsed: float) -> None:
        _CBS_DURATION.labels(verb=verb).observe(elapsed)

except Exception:  # pragma: no cover — prometheus_client optional

    def _counter(verb: str, status_label: str) -> None:  # type: ignore[misc]
        pass

    def _observe(verb: str, elapsed: float) -> None:  # type: ignore[misc]
        pass


# ---------------------------------------------------------------------------
# PII masking helper (§8 / §9.2)
# ---------------------------------------------------------------------------

_CIF_RE = re.compile(r"^[A-Z0-9]{4,16}$")
_ACCOUNT_NO_RE = re.compile(r"^[0-9]{10,20}$")


def _mask_cif(cif: str) -> str:
    """Return first 3 + '***' + last 3 characters of the CIF for structured logs."""
    if len(cif) >= 6:
        return f"{cif[:3]}***{cif[-3:]}"
    return "***"


# ---------------------------------------------------------------------------
# Exception sentinel classes (adapters may not define all of these; we catch
# by name so we can work with either the real or mock adapter)
# ---------------------------------------------------------------------------


class CustomerNotFound(LookupError):
    """Raised (or duck-typed) when T24 returns 404 for a CIF."""


class AccountNotFound(LookupError):
    """Raised (or duck-typed) when T24 returns 404 for an account."""


class T24AuthError(RuntimeError):
    """Raised when T24 OAuth2/AA-sign fails."""


class RateLimitExceeded(RuntimeError):
    """Raised when the adapter's AsyncLimiter quota is exhausted."""


# ---------------------------------------------------------------------------
# Error mapping helper (§11)
# ---------------------------------------------------------------------------


def _map_adapter_error(exc: Exception, cif: str = "", account_no: str = "") -> HTTPException:
    """
    Map an adapter exception to the correct HTTP error per §11.

    Never leaks internal details for auth failures.
    """
    name = type(exc).__name__
    msg = str(exc).lower()

    # CustomerNotFound — either the sentinel class or name/message heuristic
    if isinstance(exc, CustomerNotFound) or name == "CustomerNotFound" or "not found" in msg and cif:
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "customer_not_found", "cif": cif},
        )

    # AccountNotFound
    if isinstance(exc, AccountNotFound) or name == "AccountNotFound" or (
        "not found" in msg and account_no
    ):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "account_not_found", "account_no": account_no},
        )

    # UpstreamUnavailable — circuit open or timeout
    if isinstance(exc, UpstreamUnavailable) or name == "UpstreamUnavailable":
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "cbs_unavailable", "retry_after": 30},
        )

    # T24AuthError — never reveal why
    if isinstance(exc, T24AuthError) or name == "T24AuthError" or "auth" in msg:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": "cbs_auth_failed"},
        )

    # RateLimitExceeded
    if isinstance(exc, RateLimitExceeded) or name == "RateLimitExceeded" or "rate" in msg:
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "rate_limited"},
        )

    # Generic 5xx proxy error
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={"error": "cbs_proxy_error"},
    )


# ---------------------------------------------------------------------------
# CIF / account_no validation helper
# ---------------------------------------------------------------------------


def _validate_cif(cif: str) -> None:
    """Raise HTTP 400 if cif fails the canonical format check."""
    if not cif or not _CIF_RE.match(cif):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "validation_failed",
                "details": {"cif": "CIF must be 4–16 uppercase alphanumeric characters"},
            },
        )


def _validate_account_no(account_no: str) -> None:
    """Raise HTTP 400 if account_no fails the canonical format check."""
    if not account_no or not _ACCOUNT_NO_RE.match(account_no):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "validation_failed",
                "details": {"account_no": "account_no must be 10–20 digits"},
            },
        )


# ---------------------------------------------------------------------------
# Idempotency key helper (server-side, §11)
# ---------------------------------------------------------------------------


def _link_idempotency_key(tenant_id: str, doc_id: int, cif: str) -> str:
    """
    Derive a stable 32-char idempotency key from (tenant_id, cif, doc_id).
    Client-supplied keys are ignored for security — key is always server-derived.
    """
    raw = f"{tenant_id}|{cif}|{doc_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _push_idempotency_key(tenant_id: str, doc_id: int, target: dict) -> str:
    """Derive a stable 32-char idempotency key from (tenant_id, doc_id, target)."""
    target_str = "|".join(f"{k}={v}" for k, v in sorted(target.items()))
    raw = f"{tenant_id}|{doc_id}|{target_str}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


# ---------------------------------------------------------------------------
# Request / response shapes
# ---------------------------------------------------------------------------


class LinkDocumentRequest(BaseModel):
    """Body for the path-style link-document endpoint.

    `transaction_ref` and `transaction_type` flow from the SPA capture
    dialog through Node into the durable `cbs_document_links` record so
    regulators can reconstruct WHY a link was made, not just THAT it was.
    Both fields are optional — older clients posting only `document_id`
    still work.
    """
    document_id: int
    transaction_ref: Optional[str] = None
    transaction_type: Optional[str] = None


class HealthResponse(BaseModel):
    adapter: str
    ok: bool
    detail: str


class CustomerResponse(BaseModel):
    cif: str
    name: str
    national_id: str
    email: str
    phone: str
    risk_band: str
    kyc_status: str
    # `raw` was removed in 2026-05-09 — exposed unredacted upstream PII
    # to direct API consumers bypassing the Node SPA mirror that strips it.
    # If a future caller genuinely needs the upstream payload, gate it
    # behind admin RBAC and document the new shape.
    stale: bool = False
    cached_at: Optional[str] = None


class AccountResponse(BaseModel):
    account_no: str
    cif: str
    currency: str
    status: str
    product_code: str
    available_balance: str
    branch_id: str
    open_date: str


class LinkDocumentResponse(BaseModel):
    success: bool
    cif: str
    doc_id: int
    tenant_id: str
    remote_ref: str
    idempotency_key: str
    detail: str
    linked_at: Optional[str] = None


# --- Contract §4 request / response shapes ---


class PullCustomerRequest(BaseModel):
    """
    POST /api/v1/cbs/pull-customer request.

    JSON: {"cif": "CIF001"}
    """
    cif: str = Field(..., min_length=4, max_length=16)

    @field_validator("cif")
    @classmethod
    def cif_alphanumeric(cls, v: str) -> str:
        if not _CIF_RE.match(v):
            raise ValueError("CIF must be 4–16 uppercase alphanumeric characters")
        return v


class PullCustomerResponse(BaseModel):
    """
    POST /api/v1/cbs/pull-customer 200 response.

    JSON shape:
    {
      "cif": "CIF001",
      "name": "Fatima Al-Zahraa Mostafa",
      "national_id": "29901010123456",
      "email": "fatima@example.nbe.eg",
      "phone": "+201001234567",
      "risk_band": "LOW",
      "kyc_status": "VERIFIED",
      "stale": false,
      "cached": false,
      "cached_at": null
    }
    """
    cif: str
    name: str
    national_id: str
    email: str
    phone: str
    risk_band: str
    kyc_status: str
    stale: bool = False
    cached: bool = False
    cached_at: Optional[str] = None


class PullAccountRequest(BaseModel):
    """
    POST /api/v1/cbs/pull-account request.

    JSON: {"account_no": "001234567890"}
    """
    account_no: str = Field(..., min_length=10, max_length=20)

    @field_validator("account_no")
    @classmethod
    def account_no_digits(cls, v: str) -> str:
        if not _ACCOUNT_NO_RE.match(v):
            raise ValueError("account_no must be 10–20 digits")
        return v


class PullAccountResponse(BaseModel):
    """
    POST /api/v1/cbs/pull-account 200 response.

    JSON shape:
    {
      "account_no": "001234567890",
      "cif": "CIF001",
      "currency": "EGP",
      "status": "ACTIVE",
      "product_code": "SAVCUR",
      "available_balance": "1500000.00",
      "branch_id": "HQ",
      "open_date": "2023-01-15"
    }
    """
    account_no: str
    cif: str
    currency: str
    status: str
    product_code: str
    available_balance: str
    branch_id: str
    open_date: str


class LinkDocumentFlatRequest(BaseModel):
    """
    POST /api/v1/cbs/link-document request.

    JSON: {"cif": "CIF001", "doc_id": 42, "metadata": {...}}
    """
    cif: str = Field(..., min_length=4, max_length=16)
    doc_id: int
    metadata: dict = Field(default_factory=dict)

    @field_validator("cif")
    @classmethod
    def cif_alphanumeric(cls, v: str) -> str:
        if not _CIF_RE.match(v):
            raise ValueError("CIF must be 4–16 uppercase alphanumeric characters")
        return v


class LinkDocumentFlatResponse(BaseModel):
    """
    POST /api/v1/cbs/link-document 200 response.

    JSON shape:
    {
      "success": true,
      "cif": "CIF001",
      "doc_id": 42,
      "remote_ref": "T24-DOC-CIF001-20260509-001",
      "idempotency_key": "a7f2d3e1...",
      "linked_at": "2026-05-09T11:00:00Z"
    }
    """
    success: bool
    cif: str
    doc_id: int
    remote_ref: str
    idempotency_key: str
    linked_at: str


class PushDocumentRequest(BaseModel):
    """
    POST /api/v1/cbs/push-document request.

    JSON: {"doc_id": 42, "target": {"cif": "CIF001", "repository": "loan_file"}}
    """
    doc_id: int
    target: dict = Field(default_factory=dict)


class PushDocumentResponse(BaseModel):
    """
    POST /api/v1/cbs/push-document 200 response.

    JSON shape:
    {
      "success": true,
      "remote_id": "T24-PUSH-42abc123",
      "idempotency_key": "a7f2d3e1...",
      "pushed_at": "2026-05-09T11:01:00Z"
    }
    """
    success: bool
    remote_id: str
    idempotency_key: str
    pushed_at: str


class InvalidateCacheResponse(BaseModel):
    success: bool
    cif: str
    tenant_id: str
    detail: str


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/health
# ---------------------------------------------------------------------------


@router.get(
    "/health",
    response_model=list[HealthResponse],
    dependencies=[Depends(require_api_key)],
    summary="Health of all configured CBS adapters",
)
async def cbs_health() -> list[dict[str, Any]]:
    """
    Ping every registered adapter and return a list of HealthStatus objects.

    Uses the global INTEGRATIONS_USE_MOCKS / per-adapter env vars to
    select real vs mock adapters — same logic as all other CBS endpoints.
    """
    t0 = time.monotonic()
    results: list[dict[str, Any]] = []
    for adapter_name in list_adapters():
        try:
            adapter = await get_adapter(adapter_name, "health-check", {})
            status_obj: HealthStatus = await adapter.health()  # type: ignore[attr-defined]
            results.append({
                "adapter": status_obj.adapter,
                "ok": status_obj.ok,
                "detail": status_obj.detail,
            })
            _counter("health", "ok")
        except Exception as exc:
            logger.warning(
                '{"op": "cbs_health", "adapter": "%s", "status": "error", "error_class": "%s"}',
                adapter_name,
                type(exc).__name__,
            )
            results.append({
                "adapter": adapter_name,
                "ok": False,
                "detail": f"{type(exc).__name__}: {exc}",
            })
            _counter("health", "error")

    _observe("health", time.monotonic() - t0)
    return results


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/pull-customer  (contract §4)
# ---------------------------------------------------------------------------


@router.post(
    "/pull-customer",
    response_model=PullCustomerResponse,
    dependencies=[Depends(require_api_key)],
    summary="Pull customer master from T24 by CIF (contract §4)",
)
async def pull_customer(
    body: PullCustomerRequest,
    tenant_id: str = "default",
    principal: Principal = Depends(require("view")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Fetch a CustomerRecord from T24 (cached 5-min TTL).

    Request: {"cif": "CIF001"}
    Response: PullCustomerResponse — includes stale + cached flags.

    Error mapping:
      CustomerNotFound → 404 {error: "customer_not_found", cif: "..."}
      UpstreamUnavailable → 503 {error: "cbs_unavailable", retry_after: 30}
      ValidationError → 400 {error: "validation_failed", details: {...}}
    """
    t0 = time.monotonic()
    cif = body.cif
    # Use JWT tenant_id when available; fall back to query param
    effective_tenant = principal.tenant if principal.tenant != "default" else tenant_id
    masked = _mask_cif(cif)

    try:
        result = await refresh_customer_from_cbs(
            cif=cif,
            tenant_id=effective_tenant,
            db=db,
            adapter_name=_DEFAULT_CBS,
        )
    except Exception as exc:
        elapsed = time.monotonic() - t0
        _counter("pull_customer", "error")
        _observe("pull_customer", elapsed)
        logger.error(
            '{"op": "cbs.pull_customer", "tenant_id": "%s", "cif": "%s", '
            '"latency_ms": %d, "status": "error", "error_class": "%s"}',
            effective_tenant, masked, int(elapsed * 1000), type(exc).__name__,
        )
        raise _map_adapter_error(exc, cif=cif) from exc

    elapsed = time.monotonic() - t0
    is_stale = not result.success and result.customer is not None
    cached_at_iso = (
        datetime.now(timezone.utc).isoformat() if is_stale else None
    )

    if result.customer is None:
        _counter("pull_customer", "not_found")
        _observe("pull_customer", elapsed)
        logger.warning(
            '{"op": "cbs.pull_customer", "tenant_id": "%s", "cif": "%s", '
            '"latency_ms": %d, "status": "not_found"}',
            effective_tenant, masked, int(elapsed * 1000),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "customer_not_found", "cif": cif},
        )

    cr: CustomerRecord = result.customer
    status_label = "stale" if is_stale else "ok"
    _counter("pull_customer", status_label)
    _observe("pull_customer", elapsed)
    logger.info(
        '{"op": "cbs.pull_customer", "tenant_id": "%s", "cif": "%s", '
        '"latency_ms": %d, "status": "%s", "cached": %s}',
        effective_tenant, masked, int(elapsed * 1000), status_label,
        str(is_stale).lower(),
    )

    return {
        "cif": cr.cid,
        "name": cr.name,
        "national_id": cr.national_id,
        "email": cr.email,
        "phone": cr.phone,
        "risk_band": cr.risk_band,
        "kyc_status": cr.kyc_status,
        "stale": is_stale,
        "cached": is_stale,
        "cached_at": cached_at_iso,
    }


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/pull-account  (contract §4)
# ---------------------------------------------------------------------------


@router.post(
    "/pull-account",
    response_model=PullAccountResponse,
    dependencies=[Depends(require_api_key)],
    summary="Pull account details from T24 (contract §4)",
)
async def pull_account_flat(
    body: PullAccountRequest,
    tenant_id: str = "default",
    principal: Principal = Depends(require("view")),
) -> dict[str, Any]:
    """
    Fetch a single AccountRecord from T24 by account number.

    Request: {"account_no": "001234567890"}
    Response: PullAccountResponse

    Error mapping:
      AccountNotFound / None result → 404 {error: "account_not_found", ...}
      UpstreamUnavailable → 503
    """
    t0 = time.monotonic()
    account_no = body.account_no
    effective_tenant = principal.tenant if principal.tenant != "default" else tenant_id

    try:
        adapter = await get_adapter(_DEFAULT_CBS, effective_tenant, {})
        acct_record: AccountRecord | None = await adapter.pull_account(account_no)  # type: ignore[attr-defined]
    except Exception as exc:
        elapsed = time.monotonic() - t0
        _counter("pull_account", "error")
        _observe("pull_account", elapsed)
        logger.error(
            '{"op": "cbs.pull_account", "tenant_id": "%s", "account_no": "%s", '
            '"latency_ms": %d, "status": "error", "error_class": "%s"}',
            effective_tenant, account_no, int(elapsed * 1000), type(exc).__name__,
        )
        raise _map_adapter_error(exc, account_no=account_no) from exc

    elapsed = time.monotonic() - t0

    if acct_record is None:
        _counter("pull_account", "not_found")
        _observe("pull_account", elapsed)
        logger.warning(
            '{"op": "cbs.pull_account", "tenant_id": "%s", "account_no": "%s", '
            '"latency_ms": %d, "status": "not_found"}',
            effective_tenant, account_no, int(elapsed * 1000),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "account_not_found", "account_no": account_no},
        )

    _counter("pull_account", "ok")
    _observe("pull_account", elapsed)
    logger.info(
        '{"op": "cbs.pull_account", "tenant_id": "%s", "account_no": "%s", '
        '"latency_ms": %d, "status": "ok"}',
        effective_tenant, account_no, int(elapsed * 1000),
    )

    return {
        "account_no": acct_record.account_no,
        "cif": acct_record.cif,
        "currency": acct_record.currency,
        "status": acct_record.status,
        "product_code": acct_record.product_code,
        "available_balance": acct_record.available_balance,
        "branch_id": acct_record.branch_id,
        "open_date": acct_record.open_date,
    }


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/link-document  (contract §4, flat path)
# ---------------------------------------------------------------------------


@router.post(
    "/link-document",
    response_model=LinkDocumentFlatResponse,
    dependencies=[Depends(require_api_key)],
    summary="Link an approved DMS document to a T24 transaction (contract §4)",
    status_code=status.HTTP_200_OK,
)
async def link_document_flat(
    body: LinkDocumentFlatRequest,
    tenant_id: str = "default",
    principal: Principal = Depends(require("capture")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Register a DMS document link on CBS. Idempotent.

    Idempotency key is derived server-side from (tenant_id, cif, doc_id).
    A client-supplied key is ignored.

    Request:
    {
      "cif": "CIF001",
      "doc_id": 42,
      "metadata": {"doc_type": "NATIONAL_ID", "expiry": "2030-12-31"}
    }

    Response:
    {
      "success": true,
      "cif": "CIF001",
      "doc_id": 42,
      "remote_ref": "T24-DOC-CIF001-20260509-001",
      "idempotency_key": "a7f2d3e1...",
      "linked_at": "2026-05-09T11:00:00Z"
    }
    """
    t0 = time.monotonic()
    cif = body.cif
    doc_id = body.doc_id
    effective_tenant = principal.tenant if principal.tenant != "default" else tenant_id
    masked = _mask_cif(cif)

    # Server-side idempotency key — does not rely on any client-supplied value
    idem_key = _link_idempotency_key(effective_tenant, doc_id, cif)

    try:
        result = await link_document_to_customer(
            cif=cif,
            doc_id=doc_id,
            tenant_id=effective_tenant,
            db=db,
            metadata=body.metadata,
            adapter_name=_DEFAULT_CBS,
        )
    except Exception as exc:
        elapsed = time.monotonic() - t0
        _counter("link_document", "error")
        _observe("link_document", elapsed)
        logger.error(
            '{"op": "cbs.link_document", "tenant_id": "%s", "cif": "%s", '
            '"doc_id": %d, "latency_ms": %d, "status": "error", "error_class": "%s"}',
            effective_tenant, masked, doc_id, int(elapsed * 1000), type(exc).__name__,
        )
        raise _map_adapter_error(exc, cif=cif) from exc

    elapsed = time.monotonic() - t0
    _counter("link_document", "ok" if result.success else "error")
    _observe("link_document", elapsed)
    logger.info(
        '{"op": "cbs.link_document", "tenant_id": "%s", "cif": "%s", '
        '"doc_id": %d, "latency_ms": %d, "status": "%s", "remote_ref": "%s"}',
        effective_tenant, masked, doc_id, int(elapsed * 1000),
        "ok" if result.success else "error", result.remote_ref,
    )

    return {
        "success": result.success,
        "cif": result.cif,
        "doc_id": result.doc_id,
        "remote_ref": result.remote_ref,
        "idempotency_key": idem_key,  # server-derived, stable
        "linked_at": result.linked_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/push-document  (contract §4)
# ---------------------------------------------------------------------------


@router.post(
    "/push-document",
    response_model=PushDocumentResponse,
    dependencies=[Depends(require_api_key)],
    summary="Push a DMS document to T24's document repository (contract §4)",
    status_code=status.HTTP_200_OK,
)
async def push_document_flat(
    body: PushDocumentRequest,
    tenant_id: str = "default",
    principal: Principal = Depends(require("capture")),
) -> dict[str, Any]:
    """
    Push a DMS document to T24. Idempotent.

    Request:
    {
      "doc_id": 42,
      "target": {"cif": "CIF001", "repository": "loan_file"}
    }

    Response:
    {
      "success": true,
      "remote_id": "T24-PUSH-42abc123",
      "idempotency_key": "a7f2d3e1...",
      "pushed_at": "2026-05-09T11:01:00Z"
    }
    """
    t0 = time.monotonic()
    doc_id = body.doc_id
    target = body.target
    effective_tenant = principal.tenant if principal.tenant != "default" else tenant_id

    # Server-side idempotency key
    idem_key = _push_idempotency_key(effective_tenant, doc_id, target)

    doc = Document(
        id=str(doc_id),
        doc_type=target.get("repository", "UNKNOWN"),
        title=f"DMS document {doc_id}",
        metadata=target,
    )

    try:
        adapter = await get_adapter(_DEFAULT_CBS, effective_tenant, {})
        push_result = await adapter.push_document(doc, target)  # type: ignore[attr-defined]
    except Exception as exc:
        elapsed = time.monotonic() - t0
        _counter("push_document", "error")
        _observe("push_document", elapsed)
        logger.error(
            '{"op": "cbs.push_document", "tenant_id": "%s", "doc_id": %d, '
            '"latency_ms": %d, "status": "error", "error_class": "%s"}',
            effective_tenant, doc_id, int(elapsed * 1000), type(exc).__name__,
        )
        raise _map_adapter_error(exc) from exc

    elapsed = time.monotonic() - t0
    _counter("push_document", "ok")
    _observe("push_document", elapsed)
    logger.info(
        '{"op": "cbs.push_document", "tenant_id": "%s", "doc_id": %d, '
        '"latency_ms": %d, "status": "ok", "remote_id": "%s"}',
        effective_tenant, doc_id, int(elapsed * 1000), push_result.remote_id,
    )

    pushed_at = (
        push_result.pushed_at.isoformat()
        if hasattr(push_result, "pushed_at")
        else datetime.now(timezone.utc).isoformat()
    )

    return {
        "success": push_result.success,
        "remote_id": push_result.remote_id,
        "idempotency_key": idem_key,
        "pushed_at": pushed_at,
    }


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/customers/{cif}
# ---------------------------------------------------------------------------


@router.get(
    "/customers/{cif}",
    response_model=CustomerResponse,
    dependencies=[Depends(require_api_key)],
    summary="Pull customer from CBS by CIF (path-style)",
)
async def get_customer(
    cif: str,
    tenant_id: str = "default",
    principal: Principal = Depends(require("view")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Fetch a fresh CustomerRecord from CBS and upsert the local customers table.

    Query params:
        tenant_id — tenant context (default: "default")
    """
    _validate_cif(cif)
    t0 = time.monotonic()
    effective_tenant = principal.tenant if principal.tenant != "default" else tenant_id
    masked = _mask_cif(cif)

    try:
        result = await refresh_customer_from_cbs(
            cif=cif,
            tenant_id=effective_tenant,
            db=db,
            adapter_name=_DEFAULT_CBS,
        )
    except Exception as exc:
        elapsed = time.monotonic() - t0
        _counter("get_customer", "error")
        _observe("get_customer", elapsed)
        logger.error(
            '{"op": "cbs.get_customer", "tenant_id": "%s", "cif": "%s", '
            '"latency_ms": %d, "status": "error", "error_class": "%s"}',
            effective_tenant, masked, int(elapsed * 1000), type(exc).__name__,
        )
        raise _map_adapter_error(exc, cif=cif) from exc

    elapsed = time.monotonic() - t0

    if result.customer is None:
        _counter("get_customer", "not_found")
        _observe("get_customer", elapsed)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "customer_not_found", "cif": cif},
        )

    is_stale = not result.success
    _counter("get_customer", "stale" if is_stale else "ok")
    _observe("get_customer", elapsed)
    logger.info(
        '{"op": "cbs.get_customer", "tenant_id": "%s", "cif": "%s", '
        '"latency_ms": %d, "status": "%s", "cached": %s}',
        effective_tenant, masked, int(elapsed * 1000),
        "stale" if is_stale else "ok", str(is_stale).lower(),
    )

    cr: CustomerRecord = result.customer
    return {
        "cif": cr.cid,
        "name": cr.name,
        "national_id": cr.national_id,
        "email": cr.email,
        "phone": cr.phone,
        "risk_band": cr.risk_band,
        "kyc_status": cr.kyc_status,
        # `raw` intentionally NOT returned — see CustomerResponse comment.
        "stale": is_stale,
        "cached_at": datetime.now(timezone.utc).isoformat() if is_stale else None,
    }


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/customers/{cif}/accounts
# ---------------------------------------------------------------------------


@router.get(
    "/customers/{cif}/accounts",
    response_model=list[AccountResponse],
    dependencies=[Depends(require_api_key)],
    summary="List bank accounts for a customer CIF",
)
async def list_accounts(
    cif: str,
    tenant_id: str = "default",
    principal: Principal = Depends(require("view")),
) -> list[dict[str, Any]]:
    """
    Fetch all accounts associated with a customer CIF from CBS.

    Returns a list of AccountResponse objects.  Uses pull_customer to get
    the accounts list embedded in the CBS customer record, supplemented by
    pull_account calls where a dedicated account endpoint exists.
    """
    _validate_cif(cif)
    t0 = time.monotonic()
    effective_tenant = principal.tenant if principal.tenant != "default" else tenant_id
    masked = _mask_cif(cif)

    try:
        adapter = await get_adapter(_DEFAULT_CBS, effective_tenant, {})
        # Pull the customer first to get embedded account list
        customer = await adapter.pull_customer(cif)  # type: ignore[attr-defined]
        raw_accounts = customer.raw.get("accounts", [])

        results: list[dict[str, Any]] = []
        for acct in raw_accounts:
            account_id = acct.get("accountId", "")
            if not account_id:
                continue
            # Try to pull full account detail; fall back to summary from customer record
            try:
                acct_record: AccountRecord | None = await adapter.pull_account(account_id)  # type: ignore[attr-defined]
            except Exception:
                acct_record = None

            if acct_record:
                results.append({
                    "account_no": acct_record.account_no,
                    "cif": acct_record.cif,
                    "currency": acct_record.currency,
                    "status": acct_record.status,
                    "product_code": acct_record.product_code,
                    "available_balance": acct_record.available_balance,
                    "branch_id": acct_record.branch_id,
                    "open_date": acct_record.open_date,
                })
            else:
                results.append({
                    "account_no": account_id,
                    "cif": cif,
                    "currency": acct.get("currency", ""),
                    "status": "UNKNOWN",
                    "product_code": acct.get("productCode", ""),
                    "available_balance": "0.00",
                    "branch_id": "",
                    "open_date": acct.get("openingDate", ""),
                })

        elapsed = time.monotonic() - t0
        _counter("list_accounts", "ok")
        _observe("list_accounts", elapsed)
        logger.info(
            '{"op": "cbs.list_accounts", "tenant_id": "%s", "cif": "%s", '
            '"latency_ms": %d, "status": "ok", "count": %d}',
            effective_tenant, masked, int(elapsed * 1000), len(results),
        )
        return results

    except HTTPException:
        raise
    except Exception as exc:
        elapsed = time.monotonic() - t0
        _counter("list_accounts", "error")
        _observe("list_accounts", elapsed)
        logger.error(
            '{"op": "cbs.list_accounts", "tenant_id": "%s", "cif": "%s", '
            '"latency_ms": %d, "status": "error", "error_class": "%s"}',
            effective_tenant, masked, int(elapsed * 1000), type(exc).__name__,
        )
        raise _map_adapter_error(exc, cif=cif) from exc


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/accounts/{account_id}
# ---------------------------------------------------------------------------


@router.get(
    "/accounts/{account_id}",
    response_model=AccountResponse,
    dependencies=[Depends(require_api_key)],
    summary="Direct account lookup by account ID",
)
async def get_account(
    account_id: str,
    tenant_id: str = "default",
    principal: Principal = Depends(require("view")),
) -> dict[str, Any]:
    """
    Fetch a single account record directly by account_id.

    Error mapping:
      AccountNotFound / None → 404 {error: "account_not_found", account_no: "..."}
      UpstreamUnavailable → 503
    """
    _validate_account_no(account_id)
    t0 = time.monotonic()
    effective_tenant = principal.tenant if principal.tenant != "default" else tenant_id

    try:
        adapter = await get_adapter(_DEFAULT_CBS, effective_tenant, {})
        acct_record: AccountRecord | None = await adapter.pull_account(account_id)  # type: ignore[attr-defined]
    except Exception as exc:
        elapsed = time.monotonic() - t0
        _counter("get_account", "error")
        _observe("get_account", elapsed)
        logger.error(
            '{"op": "cbs.get_account", "tenant_id": "%s", "account_id": "%s", '
            '"latency_ms": %d, "status": "error", "error_class": "%s"}',
            effective_tenant, account_id, int(elapsed * 1000), type(exc).__name__,
        )
        raise _map_adapter_error(exc, account_no=account_id) from exc

    elapsed = time.monotonic() - t0

    if acct_record is None:
        _counter("get_account", "not_found")
        _observe("get_account", elapsed)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "account_not_found", "account_no": account_id},
        )

    _counter("get_account", "ok")
    _observe("get_account", elapsed)
    logger.info(
        '{"op": "cbs.get_account", "tenant_id": "%s", "account_id": "%s", '
        '"latency_ms": %d, "status": "ok"}',
        effective_tenant, account_id, int(elapsed * 1000),
    )

    return {
        "account_no": acct_record.account_no,
        "cif": acct_record.cif,
        "currency": acct_record.currency,
        "status": acct_record.status,
        "product_code": acct_record.product_code,
        "available_balance": acct_record.available_balance,
        "branch_id": acct_record.branch_id,
        "open_date": acct_record.open_date,
    }


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/customers/{cif}/link-document  (path-style)
# ---------------------------------------------------------------------------


@router.post(
    "/customers/{cif}/link-document",
    response_model=LinkDocumentResponse,
    dependencies=[Depends(require_api_key)],
    summary="Link a DMS document to a customer in CBS (path-style)",
    status_code=status.HTTP_200_OK,
)
async def link_document(
    cif: str,
    body: LinkDocumentRequest,
    tenant_id: str = "default",
    principal: Principal = Depends(require("capture")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Register a DMS document link on CBS for the given CIF.

    Writes the link record to the local customers table and calls
    adapter.post_document_link() upstream.  Idempotent — repeated calls
    with the same (cif, document_id) will not create duplicates.
    """
    _validate_cif(cif)
    t0 = time.monotonic()
    effective_tenant = principal.tenant if principal.tenant != "default" else tenant_id
    masked = _mask_cif(cif)

    # Forward audit metadata to the durable cbs_document_links record so
    # regulators can reconstruct the linkage context (transaction reference,
    # transaction type), not just the fact that it happened.
    metadata: dict[str, Any] = {}
    if body.transaction_ref:
        metadata["transaction_ref"] = body.transaction_ref
    if body.transaction_type:
        metadata["transaction_type"] = body.transaction_type

    try:
        result = await link_document_to_customer(
            cif=cif,
            doc_id=body.document_id,
            tenant_id=effective_tenant,
            db=db,
            metadata=metadata or None,
            adapter_name=_DEFAULT_CBS,
        )
    except Exception as exc:
        elapsed = time.monotonic() - t0
        _counter("link_document_path", "error")
        _observe("link_document_path", elapsed)
        logger.error(
            '{"op": "cbs.link_document_path", "tenant_id": "%s", "cif": "%s", '
            '"doc_id": %d, "latency_ms": %d, "status": "error", "error_class": "%s"}',
            effective_tenant, masked, body.document_id, int(elapsed * 1000), type(exc).__name__,
        )
        raise _map_adapter_error(exc, cif=cif) from exc

    elapsed = time.monotonic() - t0
    _counter("link_document_path", "ok" if result.success else "error")
    _observe("link_document_path", elapsed)
    logger.info(
        '{"op": "cbs.link_document_path", "tenant_id": "%s", "cif": "%s", '
        '"doc_id": %d, "latency_ms": %d, "status": "%s"}',
        effective_tenant, masked, body.document_id, int(elapsed * 1000),
        "ok" if result.success else "error",
    )

    return {
        "success": result.success,
        "cif": result.cif,
        "doc_id": result.doc_id,
        "tenant_id": result.tenant_id,
        "remote_ref": result.remote_ref,
        "idempotency_key": result.idempotency_key,
        "detail": result.detail,
    }


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/customers/{cif}/invalidate-cache
# ---------------------------------------------------------------------------


@router.post(
    "/customers/{cif}/invalidate-cache",
    response_model=InvalidateCacheResponse,
    dependencies=[Depends(require_api_key)],
    summary="Bust customer master cache after upstream change",
    status_code=status.HTTP_200_OK,
)
async def invalidate_customer_cache(
    cif: str,
    tenant_id: str = "default",
    principal: Principal = Depends(require("admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Force-invalidate the customer master cache for a given CIF.

    This deletes any locally cached Customer row for (cif, tenant_id) and
    performs a fresh pull from T24 to re-seed the cache.

    Required permission: admin (doc_admin role).
    """
    _validate_cif(cif)
    t0 = time.monotonic()
    effective_tenant = principal.tenant if principal.tenant != "default" else tenant_id
    masked = _mask_cif(cif)

    # Evict from local DB cache
    evicted = False
    try:
        from ..models import Customer  # type: ignore[attr-defined]
        row = (
            db.query(Customer)
            .filter(Customer.cif == cif, Customer.tenant_id == effective_tenant)
            .first()
        )
        if row is not None:
            db.delete(row)
            db.commit()
            evicted = True
    except Exception as exc:
        db.rollback()
        logger.warning(
            '{"op": "cbs.invalidate_cache", "tenant_id": "%s", "cif": "%s", '
            '"warning": "cache_evict_failed", "error_class": "%s"}',
            effective_tenant, masked, type(exc).__name__,
        )

    # Re-seed by pulling fresh data
    detail_parts = []
    if evicted:
        detail_parts.append("local cache evicted")
    try:
        await refresh_customer_from_cbs(
            cif=cif,
            tenant_id=effective_tenant,
            db=db,
            adapter_name=_DEFAULT_CBS,
        )
        detail_parts.append("cache refreshed from T24")
    except Exception as exc:
        detail_parts.append(f"T24 refresh failed ({type(exc).__name__}); cache cleared only")
        logger.warning(
            '{"op": "cbs.invalidate_cache", "tenant_id": "%s", "cif": "%s", '
            '"warning": "t24_refresh_failed", "error_class": "%s"}',
            effective_tenant, masked, type(exc).__name__,
        )

    elapsed = time.monotonic() - t0
    _counter("invalidate_cache", "ok")
    _observe("invalidate_cache", elapsed)
    logger.info(
        '{"op": "cbs.invalidate_cache", "tenant_id": "%s", "cif": "%s", '
        '"latency_ms": %d, "status": "ok", "evicted": %s}',
        effective_tenant, masked, int(elapsed * 1000), str(evicted).lower(),
    )

    return {
        "success": True,
        "cif": cif,
        "tenant_id": effective_tenant,
        "detail": "; ".join(detail_parts) or "no cached data found",
    }

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
  - "oauth2"  — standard OAuth2 client-credentials; token cached until expiry.
  - "aa_signed" — Temenos AA-* HMAC signed headers.

Rate limiting: each adapter instance owns an AsyncLimiter (10 req/s default;
override via cfg["rate_limit_rps"]).

Circuit breaker: consecutive 5xx counter tracked; after 5 failures the adapter
returns UpstreamUnavailable without attempting further calls.  Resets on
success.

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

import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from aiolimiter import AsyncLimiter

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


class UpstreamUnavailable(RuntimeError):
    """Raised when the CBS adapter's circuit breaker is open."""


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
# Mock adapter (dev + test)
# ---------------------------------------------------------------------------


class MockTemenosT24(BaseCBSAdapter):
    """
    Drop-in mock extending BaseCBSAdapter with deterministic stubs.

    Data is seeded from tests/fixtures/temenos_*.json.  configure() sets
    the tenant_id and does nothing else — no network calls, no secrets.
    """

    name: str = _ADAPTER_NAME

    def __init__(self) -> None:
        super().__init__()
        self._customer_fixture: dict = _load_fixture("temenos_customer.json")
        self._account_fixture: dict = _load_fixture("temenos_account.json")
        self._documents_fixture: dict = _load_fixture("temenos_documents.json")

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
        latency_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
            '"latency_ms": %d, "status": "ok", "cif": "%s"}',
            self.tenant_id, self.name, latency_ms, cif,
        )
        return record

    # -- pull_account --------------------------------------------------------

    async def pull_account(self, account_no: str) -> AccountRecord | None:
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
            '"latency_ms": %d, "status": "ok", "account_no": "%s"}',
            self.tenant_id, self.name, latency_ms, account_no,
        )
        return record

    # -- pull_documents -------------------------------------------------------

    async def pull_documents(self, cid: str) -> list[RemoteDoc]:
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
            # Fallback when fixture is empty
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
            self.tenant_id, self.name, latency_ms, cid, len(docs),
        )
        return docs

    # -- list_customer_documents ---------------------------------------------

    async def list_customer_documents(self, cif: str) -> list[DocumentLink]:
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
            self.tenant_id, self.name, latency_ms, cif, len(links),
        )
        return links

    # -- post_document_link --------------------------------------------------

    async def post_document_link(self, cif: str, doc_id: int, metadata: dict) -> PostResult:
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
            self.tenant_id, self.name, latency_ms, cif, doc_id,
        )
        return result

    # -- push_document -------------------------------------------------------

    async def push_document(self, doc: Document, target: dict) -> PushResult:
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
            self.tenant_id, self.name, latency_ms, doc.id, idem_key,
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

    Circuit breaker: 5 consecutive 5xx within the adapter lifetime trips it;
    subsequent calls raise UpstreamUnavailable.  Resets on first success.

    Graceful degradation: if TEMENOS_BASE_URL is unset, use
    get_temenos_adapter() factory which returns MockTemenosT24 instead.
    If set but unreachable, health() returns ok=False; pull/push raise
    UpstreamUnavailable.
    """

    name: str = _ADAPTER_NAME

    # Temenos IRIS REST v2 endpoint patterns
    _CUSTOMER_PATH = "/api/v2.0.0/holdings/customers/{cif}"
    _ACCOUNT_PATH  = "/api/v2.0.0/holdings/accounts/{account_no}"
    _SEARCH_PATH   = "/api/v2.0.0/party/customers/search"
    _DOCS_PATH     = "/api/v2.0.0/holdings/customers/{cif}/documents"
    _DOC_LINK_PATH = "/api/v2.0.0/holdings/customers/{cif}/documents"
    _HEALTH_PATH   = "/api/v2.0.0/meta/healthcheck"

    _CIRCUIT_TRIP_THRESHOLD = 5

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
        self._consecutive_errors: int = 0

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
            tenant_id, self.name, self._base_url, self._auth_mode,
        )

    # -- health --------------------------------------------------------------

    async def health(self) -> HealthStatus:
        t0 = time.monotonic()
        ok = False
        detail = ""
        version = ""
        try:
            data = await self._make_request("GET", self._HEALTH_PATH)
            ok = True
            version = str(data.get("header", {}).get("version", ""))
            detail = f"version={version}" if version else "ok"
            self._consecutive_errors = 0
        except UpstreamUnavailable as exc:
            detail = f"circuit_open: {exc}"
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
            self._consecutive_errors += 1
        latency_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            '{"tenant": "%s", "adapter": "%s", "op": "health", '
            '"latency_ms": %d, "status": "%s", "error_class": "%s"}',
            self.tenant_id, self.name, latency_ms,
            "ok" if ok else "error",
            "" if ok else type(detail).__name__,
        )
        return HealthStatus(ok=ok, adapter=self.name, detail=detail)

    # -- pull_customer -------------------------------------------------------

    async def pull_customer(self, cif: str) -> CustomerRecord:
        t0 = time.monotonic()
        try:
            path = self._CUSTOMER_PATH.format(cif=cif)
            data = await self._make_request("GET", path)
            body = data.get("body", {})
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
            self._consecutive_errors = 0
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.info(
                '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
                '"latency_ms": %d, "status": "ok", "cif": "%s"}',
                self.tenant_id, self.name, latency_ms, cif,
            )
            return record
        except Exception as exc:
            self._consecutive_errors += 1
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.error(
                '{"tenant": "%s", "adapter": "%s", "op": "pull_customer", '
                '"latency_ms": %d, "status": "error", "cif": "%s", "error_class": "%s"}',
                self.tenant_id, self.name, latency_ms, cif, type(exc).__name__,
            )
            raise UpstreamUnavailable(str(exc)) from exc

    # -- pull_account --------------------------------------------------------

    async def pull_account(self, account_no: str) -> AccountRecord | None:
        t0 = time.monotonic()
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
            self._consecutive_errors = 0
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.info(
                '{"tenant": "%s", "adapter": "%s", "op": "pull_account", '
                '"latency_ms": %d, "status": "ok", "account_no": "%s"}',
                self.tenant_id, self.name, latency_ms, account_no,
            )
            return record
        except Exception as exc:
            self._consecutive_errors += 1
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.error(
                '{"tenant": "%s", "adapter": "%s", "op": "pull_account", '
                '"latency_ms": %d, "status": "error", "account_no": "%s", "error_class": "%s"}',
                self.tenant_id, self.name, latency_ms, account_no, type(exc).__name__,
            )
            raise UpstreamUnavailable(str(exc)) from exc

    # -- pull_documents -------------------------------------------------------

    async def pull_documents(self, cid: str) -> list[RemoteDoc]:
        t0 = time.monotonic()
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
            self._consecutive_errors = 0
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.info(
                '{"tenant": "%s", "adapter": "%s", "op": "pull_documents", '
                '"latency_ms": %d, "status": "ok", "cif": "%s", "count": %d}',
                self.tenant_id, self.name, latency_ms, cid, len(docs),
            )
            return docs
        except Exception as exc:
            self._consecutive_errors += 1
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.error(
                '{"tenant": "%s", "adapter": "%s", "op": "pull_documents", '
                '"latency_ms": %d, "status": "error", "cif": "%s", "error_class": "%s"}',
                self.tenant_id, self.name, latency_ms, cid, type(exc).__name__,
            )
            raise UpstreamUnavailable(str(exc)) from exc

    # -- list_customer_documents ---------------------------------------------

    async def list_customer_documents(self, cif: str) -> list[DocumentLink]:
        t0 = time.monotonic()
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
            self._consecutive_errors = 0
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.info(
                '{"tenant": "%s", "adapter": "%s", "op": "list_customer_documents", '
                '"latency_ms": %d, "status": "ok", "cif": "%s", "count": %d}',
                self.tenant_id, self.name, latency_ms, cif, len(links),
            )
            return links
        except Exception as exc:
            self._consecutive_errors += 1
            raise UpstreamUnavailable(str(exc)) from exc

    # -- post_document_link --------------------------------------------------

    async def post_document_link(self, cif: str, doc_id: int, metadata: dict) -> PostResult:
        t0 = time.monotonic()
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
        try:
            path = self._DOC_LINK_PATH.format(cif=cif)
            data = await self._make_request("POST", path, json=payload)
            remote_ref = data.get("body", {}).get("documentId", "")
            self._consecutive_errors = 0
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.info(
                '{"tenant": "%s", "adapter": "%s", "op": "post_document_link", '
                '"latency_ms": %d, "status": "ok", "cif": "%s", "doc_id": %d}',
                self.tenant_id, self.name, latency_ms, cif, doc_id,
            )
            return PostResult(
                success=True,
                cif=cif,
                doc_id=doc_id,
                remote_ref=remote_ref,
                idempotency_key=idem_key,
            )
        except Exception as exc:
            self._consecutive_errors += 1
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.error(
                '{"tenant": "%s", "adapter": "%s", "op": "post_document_link", '
                '"latency_ms": %d, "status": "error", "cif": "%s", "doc_id": %d, '
                '"error_class": "%s"}',
                self.tenant_id, self.name, latency_ms, cif, doc_id, type(exc).__name__,
            )
            raise UpstreamUnavailable(str(exc)) from exc

    # -- push_document -------------------------------------------------------

    async def push_document(self, doc: Document, target: dict) -> PushResult:
        t0 = time.monotonic()
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
        try:
            path = self._DOC_LINK_PATH.format(cif=cif) if cif else "/api/v2.0.0/holdings/documents"
            data = await self._make_request("POST", path, json=payload)
            remote_id = data.get("body", {}).get("documentId", f"T24-{doc.id[:8]}")
            self._consecutive_errors = 0
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.info(
                '{"tenant": "%s", "adapter": "%s", "op": "push_document", '
                '"latency_ms": %d, "status": "ok", "doc_id": "%s", '
                '"idempotency_key": "%s"}',
                self.tenant_id, self.name, latency_ms, doc.id, idem_key,
            )
            return PushResult(
                success=True,
                remote_id=remote_id,
                idempotency_key=idem_key,
                adapter=self.name,
                tenant_id=self.tenant_id,
            )
        except Exception as exc:
            self._consecutive_errors += 1
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.error(
                '{"tenant": "%s", "adapter": "%s", "op": "push_document", '
                '"latency_ms": %d, "status": "error", "doc_id": "%s", "error_class": "%s"}',
                self.tenant_id, self.name, latency_ms, doc.id, type(exc).__name__,
            )
            raise UpstreamUnavailable(str(exc)) from exc

    # -- Internal helpers ----------------------------------------------------

    async def _get_token(self) -> str:
        """
        Return a valid OAuth2 bearer token, fetching a new one if expired.
        Token is cached per adapter instance (per tenant — no cross-tenant sharing).
        """
        now = time.time()
        if self._access_token and now < self._token_expires_at - 30:
            return self._access_token
        if not self._client:
            raise RuntimeError("configure() must be called before _get_token()")
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
        payload = resp.json()
        self._access_token = payload["access_token"]
        expires_in = int(payload.get("expires_in", 3600))
        self._token_expires_at = now + expires_in
        return self._access_token

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

        Raises UpstreamUnavailable if the circuit breaker is open (>= 5
        consecutive errors).  Raises httpx.HTTPStatusError for 4xx/5xx.
        """
        if self._consecutive_errors >= self._CIRCUIT_TRIP_THRESHOLD:
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

        async with self._limiter:
            resp = await self._client.request(method, url, **kwargs)
            resp.raise_for_status()
            return resp.json()


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
        "1": "LOW", "LOW": "LOW",
        "2": "MEDIUM", "MEDIUM": "MEDIUM", "MED": "MEDIUM",
        "3": "HIGH", "HIGH": "HIGH",
    }
    return mapping.get(str(raw).upper(), "UNKNOWN")

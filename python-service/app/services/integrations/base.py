"""
Base Protocol and shared dataclasses for CBS/CRM adapter surface.

All adapters implement the Adapter Protocol defined here.  No I/O at import
time; no SQLAlchemy, FastAPI, or third-party imports beyond stdlib.

Extended with BaseCBSAdapter abstract class and additional dataclasses
(AccountRecord, DocumentLink, PostResult) needed by the KYC/CIF link layer
and the CBS router.
"""
from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable


def _utcnow() -> datetime:
    """Return the current UTC time as a timezone-aware datetime."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Shared dataclasses
# ---------------------------------------------------------------------------


@dataclass
class HealthStatus:
    """Returned by Adapter.health()."""

    ok: bool
    adapter: str
    checked_at: datetime = field(default_factory=_utcnow)
    detail: str = ""


@dataclass
class CustomerRecord:
    """Canonical customer representation pulled from a remote system."""

    cid: str
    name: str
    national_id: str = ""
    email: str = ""
    phone: str = ""
    risk_band: str = "UNKNOWN"
    kyc_status: str = "UNKNOWN"
    raw: dict = field(default_factory=dict)


@dataclass
class RemoteDoc:
    """A document reference returned by the remote system."""

    remote_id: str
    doc_type: str
    title: str
    mime_type: str = "application/octet-stream"
    size_bytes: int = 0
    created_at: datetime = field(default_factory=_utcnow)
    url: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class Document:
    """A local DMS document that can be pushed to a remote system."""

    id: str
    doc_type: str
    title: str
    content: bytes = field(default=b"", repr=False)
    mime_type: str = "application/octet-stream"
    size_bytes: int = 0
    created_at: datetime = field(default_factory=_utcnow)
    metadata: dict = field(default_factory=dict)


@dataclass
class PushResult:
    """Result returned after pushing a document to a remote system."""

    success: bool
    remote_id: str
    idempotency_key: str
    adapter: str
    tenant_id: str
    detail: str = ""
    pushed_at: datetime = field(default_factory=_utcnow)


# ---------------------------------------------------------------------------
# Idempotency key helper (used by all adapters)
# ---------------------------------------------------------------------------


def make_idempotency_key(
    tenant_id: str,
    document_id: str,
    adapter_name: str,
    target_hash: str,
) -> str:
    """
    Derive a stable idempotency key from the four-tuple
    (tenant_id, document_id, adapter_name, target_hash).

    Returns the first 32 hex characters of the SHA-256 digest.
    """
    raw = f"{tenant_id}|{document_id}|{adapter_name}|{target_hash}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


# ---------------------------------------------------------------------------
# Adapter Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class Adapter(Protocol):
    """
    Every CBS/CRM adapter implements this shape exactly.

    An adapter instance is bound to a single tenant at construction time —
    no cross-tenant state sharing is allowed.
    """

    #: Stable machine-readable identifier, e.g. "temenos_t24".
    name: str

    async def configure(self, tenant_id: str, cfg: dict) -> None:
        """
        Bind this adapter to *tenant_id* and apply *cfg*.

        Implementations must store credentials from cfg without logging them.
        Real adapters read credentials via settings.integrations[tenant][adapter]
        or an injected vault client — never hard-code secrets here.
        """
        ...

    async def health(self) -> HealthStatus:
        """Ping the remote system and return a HealthStatus."""
        ...

    async def pull_customer(self, cid: str) -> CustomerRecord:
        """Fetch a customer record by CID from the remote system."""
        ...

    async def pull_documents(self, cid: str) -> list[RemoteDoc]:
        """Fetch the list of documents associated with *cid*."""
        ...

    async def push_document(self, doc: Document, target: dict) -> PushResult:
        """
        Push *doc* to the remote system described by *target*.

        Implementations must derive their idempotency key via
        make_idempotency_key(tenant_id, doc.id, self.name, target_hash).
        """
        ...


# ---------------------------------------------------------------------------
# Extended CBS-specific dataclasses
# ---------------------------------------------------------------------------


@dataclass
class AccountRecord:
    """Canonical bank account representation pulled from a CBS."""

    account_no: str
    cif: str
    currency: str = "USD"
    status: str = "UNKNOWN"
    product_code: str = ""
    available_balance: str = "0.00"
    branch_id: str = ""
    open_date: str = ""
    raw: dict = field(default_factory=dict)


@dataclass
class DocumentLink:
    """A document link stored on the CBS side (from list_customer_documents)."""

    remote_id: str
    doc_type: str
    title: str
    cif: str
    url: str = ""
    created_at: datetime = field(default_factory=_utcnow)
    metadata: dict = field(default_factory=dict)


@dataclass
class PostResult:
    """Result of posting a document link back to CBS via post_document_link."""

    success: bool
    cif: str
    doc_id: int
    remote_ref: str = ""
    idempotency_key: str = ""
    detail: str = ""
    posted_at: datetime = field(default_factory=_utcnow)


# ---------------------------------------------------------------------------
# BaseCBSAdapter — concrete subclass with extended CBS-specific interface
# ---------------------------------------------------------------------------


class BaseCBSAdapter(ABC):
    """
    Abstract base class for CBS adapters that need the extended interface
    (pull_account, list_customer_documents, post_document_link) in addition
    to the core Adapter Protocol methods.

    Subclasses must implement all abstract methods.  Credentials must come
    from the cfg dict supplied by configure() — never hard-coded.

    Tenant isolation: each instance is bound to one tenant_id via configure().
    No shared connections or cross-tenant caches are permitted.
    """

    name: str = ""

    def __init__(self) -> None:
        self.tenant_id: str = ""
        self._cfg: dict = {}

    # -- Adapter Protocol methods (abstract) --------------------------------

    @abstractmethod
    async def configure(self, tenant_id: str, cfg: dict) -> None:
        """Bind the adapter to tenant_id and apply configuration."""
        ...

    @abstractmethod
    async def health(self) -> HealthStatus:
        """Ping the remote system; return HealthStatus with ok, latency, detail."""
        ...

    @abstractmethod
    async def pull_customer(self, cif: str) -> CustomerRecord:
        """Fetch a customer record by CIF from CBS."""
        ...

    @abstractmethod
    async def pull_documents(self, cid: str) -> list[RemoteDoc]:
        """Fetch list of documents associated with cid from CBS."""
        ...

    @abstractmethod
    async def push_document(self, doc: Document, target: dict) -> PushResult:
        """Push doc to CBS; derive idempotency_key via make_idempotency_key."""
        ...

    # -- Extended CBS methods (abstract) ------------------------------------

    @abstractmethod
    async def pull_account(self, account_no: str) -> AccountRecord | None:
        """
        Fetch a single account record from CBS by account number.
        Returns None if the account does not exist.
        """
        ...

    @abstractmethod
    async def list_customer_documents(self, cif: str) -> list[DocumentLink]:
        """
        Return all document links stored against cif on the CBS side.
        """
        ...

    @abstractmethod
    async def post_document_link(
        self, cif: str, doc_id: int, metadata: dict
    ) -> PostResult:
        """
        Register a DMS document link on CBS for cif.

        Implementations must ensure idempotency — repeated calls with the
        same (cif, doc_id) must not create duplicate entries.
        """
        ...

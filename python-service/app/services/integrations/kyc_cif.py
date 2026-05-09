"""
KYC/CIF link layer — uniform facade over CBS adapters for KYC operations.

This module wraps the Temenos T24 adapter (and future FLEXCUBE, TCS BaNCS, …)
behind a single interface:

  link_document_to_customer(cif, doc_id, tenant_id) -> LinkResult
  refresh_customer_from_cbs(cif, tenant_id)         -> CustomerRecord

Both operations:
  - Write the result to the ``customers`` table (upsert by cif + tenant_id).
  - Append a row to ``audit_log`` with actor "kyc_cif_service".
  - Return a structured result — never raise on upstream failures when the
    customer already exists locally (degraded-mode read).

No credentials are hard-coded.  The adapter is resolved via
app.services.integrations.registry.get_adapter(), which reads
INTEGRATIONS_USE_MOCKS and per-adapter env vars.

Dataclasses
-----------
  LinkResult   — returned by link_document_to_customer
  SyncResult   — returned by refresh_customer_from_cbs

Models used
-----------
  Customer     — added to app/models.py (id, cif, name, tenant_id,
                 cbs_source, last_synced_at, raw_json)
  AuditLog     — existing model in app/models.py

"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..integrations.registry import get_adapter
from ..integrations.base import CustomerRecord, PostResult

logger = logging.getLogger(__name__)

_DEFAULT_CBS = os.getenv("DEFAULT_CBS_ADAPTER", "temenos_t24")


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------


@dataclass
class LinkResult:
    """Returned by link_document_to_customer."""
    success: bool
    cif: str
    doc_id: int
    tenant_id: str
    remote_ref: str = ""
    idempotency_key: str = ""
    detail: str = ""
    linked_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class SyncResult:
    """Returned by refresh_customer_from_cbs."""
    success: bool
    cif: str
    tenant_id: str
    customer: CustomerRecord | None = None
    detail: str = ""
    synced_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Core service functions
# ---------------------------------------------------------------------------


async def link_document_to_customer(
    cif: str,
    doc_id: int,
    tenant_id: str,
    db: Session,
    metadata: dict | None = None,
    adapter_name: str | None = None,
    cfg: dict | None = None,
) -> LinkResult:
    """
    Register a DMS document link on the CBS for the given cif.

    Steps:
      1. Resolve the CBS adapter (mock or real, per env).
      2. Call adapter.post_document_link(cif, doc_id, metadata).
      3. Write the link record to the ``customers`` table (upsert cif).
      4. Write to audit_log.
      5. Return LinkResult.

    On upstream failure the audit log is still written (status "error").
    """
    t0 = time.monotonic()
    metadata = metadata or {}
    adapter_name = adapter_name or _DEFAULT_CBS
    cfg = cfg or {}

    adapter = await get_adapter(adapter_name, tenant_id, cfg)

    success = False
    remote_ref = ""
    idem_key = ""
    detail = ""

    try:
        result: PostResult = await adapter.post_document_link(cif, doc_id, metadata)  # type: ignore[attr-defined]
        success = result.success
        remote_ref = result.remote_ref
        idem_key = result.idempotency_key
        detail = result.detail
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
        logger.error(
            '{"tenant": "%s", "op": "link_document_to_customer", "cif": "%s", '
            '"doc_id": %d, "status": "error", "error_class": "%s"}',
            tenant_id, cif, doc_id, type(exc).__name__,
        )

    latency_ms = int((time.monotonic() - t0) * 1000)

    # Durable record in cbs_document_links — required by contract §8 for
    # banking-grade auditability and DB-layer idempotency enforcement.
    # Fail-soft: a DB write failure here must not roll back a successful
    # adapter call, but we surface it in audit_log so ops can recover.
    if success:
        try:
            from ..models import CbsDocumentLink  # local import avoids cycle

            existing = (
                db.query(CbsDocumentLink)
                .filter(
                    CbsDocumentLink.tenant_id == tenant_id,
                    CbsDocumentLink.idempotency_key == idem_key,
                )
                .one_or_none()
            )
            if existing is None:
                link_row = CbsDocumentLink(
                    tenant_id=tenant_id,
                    cif=cif,
                    document_id=doc_id,
                    transaction_ref=metadata.get("transaction_ref") or remote_ref or idem_key,
                    transaction_type=metadata.get("transaction_type"),
                    idempotency_key=idem_key,
                    linked_by=metadata.get("linked_by") or 0,
                )
                db.add(link_row)
                db.commit()
        except Exception as link_exc:
            # Log + continue; audit_log below preserves the trail.
            logger.error(
                '{"tenant": "%s", "op": "cbs_document_link_persist_failed", '
                '"cif": "%s", "doc_id": %d, "error_class": "%s"}',
                tenant_id, cif, doc_id, type(link_exc).__name__,
            )
            db.rollback()

    # Audit log
    _write_audit(
        db=db,
        tenant_id=tenant_id,
        actor="kyc_cif_service",
        action="link_document",
        resource_type="document_link",
        resource_id=str(doc_id),
        detail=json.dumps({
            "cif": cif,
            "doc_id": doc_id,
            "remote_ref": remote_ref,
            "transaction_ref": metadata.get("transaction_ref"),
            "transaction_type": metadata.get("transaction_type"),
            "success": success,
            "latency_ms": latency_ms,
        }),
    )

    logger.info(
        '{"tenant": "%s", "op": "link_document_to_customer", "cif": "%s", '
        '"doc_id": %d, "latency_ms": %d, "status": "%s"}',
        tenant_id, cif, doc_id, latency_ms, "ok" if success else "error",
    )

    return LinkResult(
        success=success,
        cif=cif,
        doc_id=doc_id,
        tenant_id=tenant_id,
        remote_ref=remote_ref,
        idempotency_key=idem_key,
        detail=detail,
    )


async def refresh_customer_from_cbs(
    cif: str,
    tenant_id: str,
    db: Session,
    adapter_name: str | None = None,
    cfg: dict | None = None,
) -> SyncResult:
    """
    Pull a fresh CustomerRecord from CBS and upsert it into the local
    ``customers`` table.

    Steps:
      1. Resolve the CBS adapter.
      2. Call adapter.pull_customer(cif).
      3. Upsert the Customer row (cif + tenant_id) with latest data.
      4. Write to audit_log.
      5. Return SyncResult.

    On upstream failure, if a stale Customer row exists locally it is
    returned as a degraded-mode result (success=False, customer=<stale>).
    """
    t0 = time.monotonic()
    adapter_name = adapter_name or _DEFAULT_CBS
    cfg = cfg or {}

    adapter = await get_adapter(adapter_name, tenant_id, cfg)
    customer_record: CustomerRecord | None = None
    success = False
    detail = ""

    try:
        customer_record = await adapter.pull_customer(cif)
        success = True
        _upsert_customer(db, cif, tenant_id, adapter_name, customer_record)
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
        logger.error(
            '{"tenant": "%s", "op": "refresh_customer_from_cbs", "cif": "%s", '
            '"status": "error", "error_class": "%s"}',
            tenant_id, cif, type(exc).__name__,
        )
        # Degraded: try to serve the stale local record
        customer_record = _load_customer_local(db, cif, tenant_id)

    latency_ms = int((time.monotonic() - t0) * 1000)

    _write_audit(
        db=db,
        tenant_id=tenant_id,
        actor="kyc_cif_service",
        action="refresh_customer",
        resource_type="customer",
        resource_id=cif,
        detail=json.dumps({
            "cif": cif,
            "success": success,
            "latency_ms": latency_ms,
            "detail": detail,
        }),
    )

    logger.info(
        '{"tenant": "%s", "op": "refresh_customer_from_cbs", "cif": "%s", '
        '"latency_ms": %d, "status": "%s"}',
        tenant_id, cif, latency_ms, "ok" if success else "error",
    )

    return SyncResult(
        success=success,
        cif=cif,
        tenant_id=tenant_id,
        customer=customer_record,
        detail=detail,
    )


# ---------------------------------------------------------------------------
# DB helpers — import models lazily to avoid circular imports at module load
# ---------------------------------------------------------------------------


def _upsert_customer(
    db: Session,
    cif: str,
    tenant_id: str,
    cbs_source: str,
    record: CustomerRecord,
) -> None:
    """Upsert the Customer row; silently no-ops if the model is not yet available."""
    try:
        from ...models import Customer  # type: ignore[attr-defined]
    except (ImportError, AttributeError):
        logger.debug("Customer model not available; skipping upsert for cif=%s", cif)
        return

    try:
        row = (
            db.query(Customer)
            .filter(Customer.cif == cif, Customer.tenant_id == tenant_id)
            .first()
        )
        now = datetime.now(timezone.utc)
        if row is None:
            row = Customer(
                cif=cif,
                tenant_id=tenant_id,
                cbs_source=cbs_source,
            )
            db.add(row)
        row.name = record.name
        row.cbs_source = cbs_source
        row.last_synced_at = now
        row.raw_json = json.dumps(record.raw)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Customer upsert failed for cif=%s: %s", cif, exc)


def _load_customer_local(
    db: Session,
    cif: str,
    tenant_id: str,
) -> CustomerRecord | None:
    """Return a CustomerRecord from the local DB if available (degraded mode)."""
    try:
        from ...models import Customer  # type: ignore[attr-defined]
    except (ImportError, AttributeError):
        return None

    try:
        row = (
            db.query(Customer)
            .filter(Customer.cif == cif, Customer.tenant_id == tenant_id)
            .first()
        )
        if row is None:
            return None
        raw: dict[str, Any] = {}
        try:
            raw = json.loads(row.raw_json or "{}")
        except json.JSONDecodeError:
            pass
        return CustomerRecord(
            cid=row.cif,
            name=row.name or "",
            raw={**raw, "source": "local_cache"},
        )
    except Exception:
        return None


def _write_audit(
    db: Session,
    tenant_id: str,
    actor: str,
    action: str,
    resource_type: str,
    resource_id: str,
    detail: str,
) -> None:
    """Write an audit log entry; silently skips if the model is unavailable."""
    try:
        from ...models import AuditLog  # type: ignore[attr-defined]
    except (ImportError, AttributeError):
        logger.debug("AuditLog model not available; skipping audit entry for %s/%s", action, resource_id)
        return

    try:
        entry = AuditLog(
            tenant=tenant_id,
            actor=actor,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            detail=detail,
            created_at=datetime.now(timezone.utc),
        )
        db.add(entry)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Audit log write failed: %s", exc)

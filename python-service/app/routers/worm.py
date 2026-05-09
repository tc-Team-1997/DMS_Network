"""WORM retention-lock router (BHU-32).

Provides filesystem-level Write-Once-Read-Many immutability for documents
under retention.  All mutation endpoints require the `doc_admin` role.
Status reads require at minimum the `viewer` role (via `view` permission).

Feature flag: FF_WORM (env var).  When absent or falsy all lock/unlock/verify
operations return 503.  Status reads are always available so the badge can
render the current state of pre-existing locks.

Paths
-----
POST   /api/v1/documents/{document_id}/worm/lock
POST   /api/v1/documents/{document_id}/worm/unlock
GET    /api/v1/documents/{document_id}/worm/status
POST   /api/v1/worm/verify-batch

Auth: require_api_key (gateway) + JWT role check (per endpoint).
Tenant boundary: every DB query is filtered by principal.tenant.
Audit: every mutation writes an AuditLog row.
PII: file paths beyond the basename are never logged.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AuditLog, Document
from ..security import require_api_key
from ..services.auth import Principal, require
from ..services import worm as worm_svc

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

_FF_WORM = os.environ.get("FF_WORM", "").strip().lower() not in ("", "0", "false", "off")


def _require_ff() -> None:
    """Raise 503 when the WORM feature flag is off."""
    if not _FF_WORM:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WORM feature flag FF_WORM is disabled",
        )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(
    prefix="/api/v1",
    tags=["worm"],
    dependencies=[Depends(require_api_key)],
)

# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class LockRequest(BaseModel):
    unlock_after_days: int = Field(ge=1, le=36525, description="Days until unlock is permitted")
    reason: str = Field(min_length=1, max_length=512)


class LockResponse(BaseModel):
    document_id: int
    locked_at: str
    unlock_after: str
    sha256_baseline: str
    status: Literal["locked"]


class UnlockRequest(BaseModel):
    reason: Literal["legal_hold_released", "retention_expired", "error_correction"]
    approver_notes: str = Field(default="", max_length=1024)


class UnlockResponse(BaseModel):
    document_id: int
    unlocked_at: str
    unlock_reason: str
    status: Literal["unlocked"]


class WormStatusResponse(BaseModel):
    document_id: int
    worm_locked: bool
    locked_at: str | None
    unlock_after: str | None
    sha256_baseline: str | None
    sha256_current: str | None
    tampered: bool
    os_flag_set: bool


class VerifyBatchResponse(BaseModel):
    examined: int
    ok: int
    tampered: int
    missing: int
    ran_at: str


# ---------------------------------------------------------------------------
# Helper: resolve document with tenant guard
# ---------------------------------------------------------------------------

def _get_doc(document_id: int, tenant: str, db: Session) -> Document:
    doc = (
        db.query(Document)
        .filter(Document.id == document_id, Document.tenant == tenant)
        .first()
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _resolve_file_path(doc: Document) -> Path:
    from ..config import settings
    storage_dir = Path(settings.STORAGE_DIR)
    if not doc.filename:
        raise HTTPException(status_code=409, detail="Document has no stored file")
    fp = storage_dir / doc.filename
    if not fp.exists():
        raise HTTPException(status_code=409, detail="Document file not found on storage")
    return fp


def _audit(
    db: Session,
    tenant: str,
    actor: str,
    action: str,
    document_id: int,
    detail: str,
) -> None:
    db.add(AuditLog(
        tenant=tenant,
        actor=actor,
        action=action,
        resource_type="document",
        resource_id=str(document_id),
        detail=detail,
    ))


# ---------------------------------------------------------------------------
# POST /api/v1/documents/{document_id}/worm/lock
# ---------------------------------------------------------------------------

@router.post(
    "/documents/{document_id}/worm/lock",
    response_model=LockResponse,
    summary="Lock document with WORM immutable flag",
)
def lock_document(
    document_id: int,
    body: LockRequest,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> LockResponse:
    """Set the OS immutable flag on the document's stored file and record the
    WORM lock in the database.  Idempotent: if the document is already locked
    the existing lock state is returned (200) without error.

    Requires role: doc_admin.
    """
    _require_ff()

    doc = _get_doc(document_id, p.tenant, db)

    # Idempotent: return current state if already locked.
    if doc.worm_locked_at is not None:
        return LockResponse(
            document_id=doc.id,
            locked_at=doc.worm_locked_at.isoformat() + "Z",
            unlock_after=(
                doc.worm_unlock_after.isoformat() + "Z"
                if doc.worm_unlock_after else ""
            ),
            sha256_baseline=doc.sha256_at_lock or "",
            status="locked",
        )

    file_path = _resolve_file_path(doc)

    # Compute SHA-256 baseline before setting the flag.
    sha256_baseline = worm_svc.compute_sha256(file_path)

    # Apply OS immutable flag — fail loudly if it cannot be set.
    try:
        worm_svc.apply_immutable_flag(file_path)
    except (RuntimeError, FileNotFoundError) as exc:
        log.error(
            "worm.lock failed for document_id=%d filename=%s: %s",
            document_id,
            doc.filename,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not set immutable flag: {exc}",
        ) from exc

    now = datetime.utcnow()
    unlock_after = now + timedelta(days=body.unlock_after_days)

    doc.worm_locked_at = now
    doc.worm_unlock_after = unlock_after
    doc.sha256_at_lock = sha256_baseline
    doc.worm_release_reason = None

    _audit(
        db, p.tenant, p.sub,
        "WORM_LOCKED",
        document_id,
        (
            f"reason={body.reason} "
            f"unlock_after_days={body.unlock_after_days} "
            f"sha256_baseline={sha256_baseline[:16]}..."
        ),
    )

    db.commit()
    db.refresh(doc)

    log.info(
        "worm.lock ok document_id=%d tenant=%s unlock_after_days=%d",
        document_id, p.tenant, body.unlock_after_days,
    )

    return LockResponse(
        document_id=doc.id,
        locked_at=doc.worm_locked_at.isoformat() + "Z",
        unlock_after=doc.worm_unlock_after.isoformat() + "Z",
        sha256_baseline=sha256_baseline,
        status="locked",
    )


# ---------------------------------------------------------------------------
# POST /api/v1/documents/{document_id}/worm/unlock
# ---------------------------------------------------------------------------

@router.post(
    "/documents/{document_id}/worm/unlock",
    response_model=UnlockResponse,
    summary="Unlock document and remove OS immutable flag",
)
def unlock_document(
    document_id: int,
    body: UnlockRequest,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> UnlockResponse:
    """Remove the OS immutable flag and clear the WORM lock record.

    Idempotent: if the document is already unlocked an UnlockResponse is
    returned with the current timestamp and status=unlocked.

    Requires role: doc_admin.
    """
    _require_ff()

    doc = _get_doc(document_id, p.tenant, db)

    now = datetime.utcnow()

    # Already unlocked — idempotent response.
    if doc.worm_locked_at is None:
        return UnlockResponse(
            document_id=doc.id,
            unlocked_at=now.isoformat() + "Z",
            unlock_reason=body.reason,
            status="unlocked",
        )

    file_path = _resolve_file_path(doc)

    # Remove OS immutable flag.
    try:
        worm_svc.release_immutable_flag(file_path)
    except (RuntimeError, FileNotFoundError) as exc:
        log.error(
            "worm.unlock failed for document_id=%d filename=%s: %s",
            document_id,
            doc.filename,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not release immutable flag: {exc}",
        ) from exc

    doc.worm_locked_at = None
    doc.worm_unlock_after = None
    doc.worm_release_reason = body.reason

    detail = (
        f"reason={body.reason} "
        f"approver_notes_len={len(body.approver_notes)} "
        f"actor={p.sub}"
    )
    if body.approver_notes:
        detail += f" approver_notes_preview={body.approver_notes[:80]}"

    _audit(db, p.tenant, p.sub, "WORM_UNLOCKED", document_id, detail)

    db.commit()
    db.refresh(doc)

    log.info(
        "worm.unlock ok document_id=%d tenant=%s reason=%s",
        document_id, p.tenant, body.reason,
    )

    return UnlockResponse(
        document_id=doc.id,
        unlocked_at=now.isoformat() + "Z",
        unlock_reason=body.reason,
        status="unlocked",
    )


# ---------------------------------------------------------------------------
# GET /api/v1/documents/{document_id}/worm/status
# ---------------------------------------------------------------------------

@router.get(
    "/documents/{document_id}/worm/status",
    response_model=WormStatusResponse,
    summary="Query WORM lock status and hash integrity",
)
def worm_status(
    document_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("view")),
) -> WormStatusResponse:
    """Return current WORM lock state plus live SHA-256 comparison.

    Available to all roles >= viewer.  No audit write (read-only).
    """
    doc = _get_doc(document_id, p.tenant, db)

    worm_locked = doc.worm_locked_at is not None
    sha256_current: str | None = None
    os_flag_set = False
    tampered = False

    if worm_locked and doc.filename:
        from ..config import settings
        fp = Path(settings.STORAGE_DIR) / doc.filename
        if fp.exists():
            try:
                sha256_current = worm_svc.compute_sha256(fp)
                if doc.sha256_at_lock and sha256_current != doc.sha256_at_lock:
                    tampered = True
            except OSError:
                pass
            try:
                os_flag_set = worm_svc.is_immutable(fp)
            except RuntimeError:
                os_flag_set = False

    return WormStatusResponse(
        document_id=doc.id,
        worm_locked=worm_locked,
        locked_at=doc.worm_locked_at.isoformat() + "Z" if doc.worm_locked_at else None,
        unlock_after=doc.worm_unlock_after.isoformat() + "Z" if doc.worm_unlock_after else None,
        sha256_baseline=doc.sha256_at_lock,
        sha256_current=sha256_current,
        tampered=tampered,
        os_flag_set=os_flag_set,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/worm/verify-batch
# ---------------------------------------------------------------------------

@router.post(
    "/worm/verify-batch",
    response_model=VerifyBatchResponse,
    summary="Trigger on-demand WORM integrity verification for all locked documents",
)
def verify_batch(
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> VerifyBatchResponse:
    """Walk all WORM-locked documents for the caller's tenant, recompute
    SHA-256 for each, and alert on drift.  Creates AlertRecord + AuditLog
    rows for every tampered or missing file.

    Requires role: doc_admin.
    """
    _require_ff()

    summary = worm_svc.verify_all_locked(db, p.tenant)

    _audit(
        db, p.tenant, p.sub,
        "WORM_VERIFY_BATCH",
        0,
        (
            f"examined={summary['examined']} ok={summary['ok']} "
            f"tampered={summary['tampered']} missing={summary['missing']}"
        ),
    )
    db.commit()

    log.info(
        "worm.verify_batch complete tenant=%s examined=%d tampered=%d missing=%d",
        p.tenant,
        summary["examined"],
        summary["tampered"],
        summary["missing"],
    )

    return VerifyBatchResponse(**summary)

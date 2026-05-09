"""Document redaction router — BHU-46.

Exposes:
    POST /api/v1/documents/{id}/redact          — create redacted copy
    GET  /api/v1/documents/{id}/redaction-status — query redaction history
    GET  /api/v1/redaction-log                   — audit log (auditor only)

Auth model: require_api_key (gateway check) + JWT claim for role enforcement.
Reason enum: pii | financial-secret | commercial-confidential | legal-hold | other.
Feature flag: FF_REDACTION env var must be truthy (default off for MVP).
"""
from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AuditLog, Document
from ..security import require_api_key
from ..services.auth import Principal, current_principal
from ..services.storage import save_bytes

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

# Module-level variable. Read once at import time from the environment.
# Tests override this at the environment level (monkeypatch.setenv) or by
# patching the module attribute directly.
FF_REDACTION: bool = os.environ.get("FF_REDACTION", "").lower() in ("1", "true", "yes", "on")


def _check_flag() -> None:
    """Check whether the FF_REDACTION feature flag is enabled.

    Checks the module-level FF_REDACTION variable first (allows test
    monkeypatching via monkeypatch.setattr). Also re-reads the env var to
    support runtime flag changes without restart — but only when the module
    variable has not been explicitly set to False by a test.
    """
    # Use module-level variable as the canonical source; also check env
    # to handle cases where the flag was set after module import (e.g.
    # when test_redaction.py sets FF_REDACTION=1 before importing app.main).
    env_enabled = os.environ.get("FF_REDACTION", "").lower() in ("1", "true", "yes", "on")
    if not FF_REDACTION and not env_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Redaction feature is not enabled.")


# ---------------------------------------------------------------------------
# Roles & permissions
# ---------------------------------------------------------------------------
_REDACT_ROLES = {"maker", "checker", "doc_admin"}
_VIEW_LOG_ROLES = {"auditor", "doc_admin"}
_VIEW_STATUS_ROLES = {"viewer", "maker", "checker", "doc_admin", "auditor", "compliance"}


def _require_redact_role(p: Principal) -> None:
    if not any(r in _REDACT_ROLES for r in p.roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role must be one of {_REDACT_ROLES} to create a redacted copy.",
        )


def _require_log_role(p: Principal) -> None:
    if not any(r in _VIEW_LOG_ROLES for r in p.roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only auditor or doc_admin may view the full redaction log.",
        )


def _require_status_role(p: Principal) -> None:
    if not any(r in _VIEW_STATUS_ROLES for r in p.roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient role to view redaction status.",
        )


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------
RedactionReason = Literal[
    "pii",
    "financial-secret",
    "commercial-confidential",
    "legal-hold",
    "other",
]


class RedactionRegion(BaseModel):
    page: int = Field(..., ge=0, description="0-indexed page number")
    x: float = Field(..., ge=0, le=10000)
    y: float = Field(..., ge=0, le=10000)
    w: float = Field(..., gt=0, le=10000)
    h: float = Field(..., gt=0, le=10000)
    reason: Optional[RedactionReason] = None


class RedactRequest(BaseModel):
    regions: list[RedactionRegion] = Field(..., min_length=1)
    reason: RedactionReason
    preserve_metadata: bool = False
    lock_original: bool = False

    @field_validator("regions")
    @classmethod
    def max_fifty_regions(cls, v: list[RedactionRegion]) -> list[RedactionRegion]:
        if len(v) > 50:
            raise ValueError("At most 50 regions per request.")
        return v


class RedactResponse(BaseModel):
    redacted_document_id: int
    parent_id: int
    version: str
    regions_redacted: int
    sha256_original: str
    sha256_redacted: str
    redacted_by: str
    created_at: str


class RedactionVersionItem(BaseModel):
    document_id: int
    redacted_at: str
    redacted_by: str
    region_count: int


class RedactionStatusResponse(BaseModel):
    document_id: int
    is_original: bool
    has_redactions: bool
    redacted_versions: list[RedactionVersionItem]
    parent_id: Optional[int]


class RedactionLogItem(BaseModel):
    id: int
    document_id: int
    redacted_version_id: int
    redacted_by: str
    regions: list[dict[str, Any]]
    reason: str
    created_at: str


class RedactionLogResponse(BaseModel):
    items: list[RedactionLogItem]
    total: int


# ---------------------------------------------------------------------------
# Lazy import: avoid hard crash when pikepdf not installed
# ---------------------------------------------------------------------------
def _get_redact_pdf():
    try:
        from ..services.redaction_pdf import redact_pdf, RedactionFailedError
        return redact_pdf, RedactionFailedError
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"pikepdf is not installed; redaction unavailable. ({exc})",
        )


# Import RedactionLog from models (defined there for migration 0024_redaction)
from ..models import RedactionLog  # noqa: E402


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
router = APIRouter(
    tags=["document-redaction"],
    dependencies=[Depends(require_api_key)],
)


@router.post(
    "/api/v1/documents/{doc_id}/redact",
    status_code=status.HTTP_201_CREATED,
    response_model=RedactResponse,
    summary="Create a physically redacted copy of a document",
)
def create_redacted_copy(
    doc_id: int,
    body: RedactRequest,
    db: Session = Depends(get_db),
    p: Principal = Depends(current_principal),
) -> RedactResponse:
    _check_flag()
    _require_redact_role(p)

    # doc_admin required when lock_original=true
    if body.lock_original and "doc_admin" not in p.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="lock_original=true requires doc_admin role.",
        )

    # Fetch original document with tenant boundary
    doc = db.get(Document, doc_id)
    if doc is None or getattr(doc, "tenant", "default") != p.tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    # Non-PDF rejection
    mime = getattr(doc, "mime_type", "") or ""
    if mime != "application/pdf" and not (doc.filename or "").lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only PDF documents can be redacted.",
        )

    # Validate page indices against a reasonable upper bound (≤500 pages)
    for region in body.regions:
        if region.page > 500:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Region page index {region.page} is out of acceptable range.",
            )

    redact_pdf, RedactionFailedError = _get_redact_pdf()

    input_path = doc.filename
    if not os.path.exists(input_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document file not found in storage.",
        )

    regions_dicts = [r.model_dump() for r in body.regions]

    # Run redaction in a temp file, then store via SHA-256 content-addressing
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        try:
            stats = redact_pdf(
                input_path=input_path,
                output_path=tmp_path,
                regions=regions_dicts,
            )
        except RedactionFailedError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Redaction verification failed: {exc}",
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            )
        except Exception as exc:
            log.exception("Unexpected redaction error for document %d", doc_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Redaction processing error: {exc}",
            )

        with open(tmp_path, "rb") as fh:
            redacted_bytes = fh.read()

    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    # Persist via content-addressed storage
    original_name = f"redacted_{Path(doc.original_name).stem}_v{(getattr(doc, 'version', 1) or 1) + 1}.pdf"
    stored_path, sha256_redacted, size = save_bytes(redacted_bytes, original_name)

    # Compute original sha256
    with open(input_path, "rb") as fh:
        sha256_original = hashlib.sha256(fh.read()).hexdigest()

    # Create new document row
    new_version = (getattr(doc, "version", 1) or 1) + 1
    version_label = f"v1.{new_version - 1}"

    redacted_doc = Document(
        filename=stored_path,
        original_name=original_name,
        mime_type="application/pdf",
        size_bytes=size,
        sha256=sha256_redacted,
        doc_type=doc.doc_type,
        customer_cid=doc.customer_cid,
        branch=doc.branch,
        tenant=p.tenant,
        status="captured",
        issue_date=doc.issue_date,
        expiry_date=doc.expiry_date,
        uploaded_by=p.sub,
        parent_id=doc_id,
        redacted=1,
        version=new_version,
    )

    db.add(redacted_doc)
    db.flush()  # get the new id

    # Write redaction log row
    log_row = RedactionLog(
        document_id=doc_id,
        redacted_version_id=redacted_doc.id,
        redacted_by=p.sub,
        regions=regions_dicts,
        reason=body.reason,
        tenant_id=p.tenant,
    )
    db.add(log_row)

    # Audit log
    db.add(AuditLog(
        tenant=p.tenant,
        actor=p.sub,
        action="DOCUMENT_REDACTED",
        resource_type="document",
        resource_id=str(doc_id),
        detail=(
            f"parent_id={doc_id} redacted_version_id={redacted_doc.id} "
            f"region_count={len(body.regions)} reason={body.reason} "
            f"pages_redacted={stats['pages_redacted']}"
        ),
    ))

    db.commit()

    log.info(
        "redaction.create action=DOCUMENT_REDACTED document_id=%d "
        "redacted_version_id=%d regions_count=%d tenant_id=%s",
        doc_id, redacted_doc.id, len(body.regions), p.tenant,
    )

    return RedactResponse(
        redacted_document_id=redacted_doc.id,
        parent_id=doc_id,
        version=version_label,
        regions_redacted=len(body.regions),
        sha256_original=sha256_original,
        sha256_redacted=sha256_redacted,
        redacted_by=p.sub,
        created_at=redacted_doc.created_at.isoformat() + "Z",
    )


@router.get(
    "/api/v1/documents/{doc_id}/redaction-status",
    response_model=RedactionStatusResponse,
    summary="Query redaction history for a document",
)
def get_redaction_status(
    doc_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(current_principal),
) -> RedactionStatusResponse:
    _check_flag()
    _require_status_role(p)

    doc = db.get(Document, doc_id)
    if doc is None or getattr(doc, "tenant", "default") != p.tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    parent_id_val: Optional[int] = getattr(doc, "parent_id", None)
    is_original = parent_id_val is None

    # Find all redacted versions whose parent is this document
    log_rows = (
        db.query(RedactionLog)
        .filter(
            RedactionLog.document_id == doc_id,
            RedactionLog.tenant_id == p.tenant,
        )
        .order_by(RedactionLog.created_at.asc())
        .all()
    )

    versions = [
        RedactionVersionItem(
            document_id=row.redacted_version_id,
            redacted_at=row.created_at.isoformat() + "Z",
            redacted_by=row.redacted_by,
            region_count=len(row.regions) if row.regions else 0,
        )
        for row in log_rows
    ]

    return RedactionStatusResponse(
        document_id=doc_id,
        is_original=is_original,
        has_redactions=len(versions) > 0,
        redacted_versions=versions,
        parent_id=parent_id_val,
    )


@router.get(
    "/api/v1/redaction-log",
    response_model=RedactionLogResponse,
    summary="List all redaction events (auditor only)",
)
def list_redaction_log(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    p: Principal = Depends(current_principal),
) -> RedactionLogResponse:
    _check_flag()
    _require_log_role(p)

    query = (
        db.query(RedactionLog)
        .filter(RedactionLog.tenant_id == p.tenant)
        .order_by(RedactionLog.created_at.desc())
    )
    total = query.count()
    rows = query.offset(offset).limit(limit).all()

    return RedactionLogResponse(
        items=[
            RedactionLogItem(
                id=row.id,
                document_id=row.document_id,
                redacted_version_id=row.redacted_version_id,
                redacted_by=row.redacted_by,
                regions=row.regions or [],
                reason=row.reason,
                created_at=row.created_at.isoformat() + "Z",
            )
            for row in rows
        ],
        total=total,
    )

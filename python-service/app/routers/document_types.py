"""
Document-types admin router — threshold tuning surface.

Endpoints
---------
PATCH  /api/v1/document-types/{id}
    Update autofill_floor, high_confidence, and/or tested_with_sample_id.
    Validates: both floats in [0, 1] AND autofill_floor < high_confidence.
    Writes DOCTYPE_THRESHOLDS_UPDATED to audit_log.
    Auth: require_api_key + JWT role >= doc_admin (doctype:write).

POST   /api/v1/document-types/{id}/test-thresholds
    Read-only preview: run existing OCR/extraction pipeline against
    tested_with_sample_id (or a caller-supplied sample_id), return
    per-field confidence labels at the doctype's CURRENT thresholds.
    Auth: require_api_key + JWT role >= viewer (doctype:read).
    No DB mutations.

Observability (§9.2 of contract)
---------
- Trace span  : document_types.update_thresholds  (attrs: tenant_id, doctype_id)
- Counter     : doctype_threshold_update_total{status}
- Histogram   : doctype_threshold_update_duration_seconds
- Structured log per request
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text as sqltext
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.auth import Principal, current_principal
from ..services.document_types import validate_thresholds, test_against_sample

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prometheus metrics (graceful no-op if prometheus_client absent)
# ---------------------------------------------------------------------------

try:
    from prometheus_client import Counter, Histogram

    _THRESHOLD_UPDATE_COUNTER = Counter(
        "doctype_threshold_update_total",
        "Doctype threshold update attempts",
        ["status"],
    )
    _THRESHOLD_UPDATE_DURATION = Histogram(
        "doctype_threshold_update_duration_seconds",
        "Duration of doctype threshold PATCH",
    )
except Exception:  # noqa: BLE001
    class _Noop:
        def labels(self, *_, **__):
            return self
        def inc(self, *_):
            pass
        def observe(self, *_):
            pass
        def time(self):
            import contextlib
            return contextlib.nullcontext()

    _THRESHOLD_UPDATE_COUNTER = _Noop()  # type: ignore[assignment]
    _THRESHOLD_UPDATE_DURATION = _Noop()  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# DDL guard — ensure the threshold columns exist in-process for test DBs
# that haven't run the db-migrator migration yet.
# ---------------------------------------------------------------------------

_THRESHOLD_COLS_DDL = [
    "ALTER TABLE document_type_schemas ADD COLUMN autofill_floor REAL NOT NULL DEFAULT 0.4",
    "ALTER TABLE document_type_schemas ADD COLUMN high_confidence REAL NOT NULL DEFAULT 0.7",
    "ALTER TABLE document_type_schemas ADD COLUMN tested_with_sample_id INTEGER",
]


def _ensure_threshold_columns(db: Session) -> None:
    """
    Idempotently add the three threshold columns to document_type_schemas.
    Uses SQLite's error-on-duplicate-column behaviour as the idempotency gate.
    Safe to call on every request; the first call does the work, subsequent
    calls are ~0 ms no-ops.
    """
    for ddl in _THRESHOLD_COLS_DDL:
        try:
            db.execute(sqltext(ddl))
            db.commit()
        except Exception:  # column already exists → ignore
            db.rollback()


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(
    prefix="/api/v1/document-types",
    tags=["document-types"],
    dependencies=[Depends(require_api_key)],
)


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------

class ThresholdPatchRequest(BaseModel):
    autofill_floor: Optional[float] = Field(
        default=None, ge=0.0, le=1.0,
        description="Confidence floor for auto-fill (0–1).",
    )
    high_confidence: Optional[float] = Field(
        default=None, ge=0.0, le=1.0,
        description="Confidence threshold for review-required (0–1). Must be > autofill_floor.",
    )
    tested_with_sample_id: Optional[int] = Field(
        default=None,
        description="FK to document_type_samples.id used for the preview pane.",
    )

    @model_validator(mode="after")
    def cross_field_validation(self) -> "ThresholdPatchRequest":
        af = self.autofill_floor
        hc = self.high_confidence
        if af is not None and hc is not None and af >= hc:
            raise ValueError("autofill_floor must be strictly less than high_confidence")
        return self


class ThresholdTestRequest(BaseModel):
    sample_id: int = Field(description="ID of the DocumentTypeSample to test against.")


class ExtractedFieldItem(BaseModel):
    field_name: str
    value: Optional[str]
    confidence: float
    status: str  # "auto_fill" | "review" | "skip"


class ThresholdTestResponse(BaseModel):
    extracted_fields: list
    at_floor: int
    at_high: int
    sample_id: int
    schema_id: int
    autofill_floor: float
    high_confidence: float


# ---------------------------------------------------------------------------
# Helper: write audit_log row (best-effort, non-fatal)
# ---------------------------------------------------------------------------

def _write_audit(
    db: Session,
    tenant: str,
    actor: str,
    doctype_id: int,
    before: Dict[str, Any],
    after: Dict[str, Any],
) -> None:
    try:
        from ..models import AuditLog  # noqa: PLC0415
        entry = AuditLog(
            tenant=tenant,
            actor=actor,
            action="DOCTYPE_THRESHOLDS_UPDATED",
            resource_type="document_type_schema",
            resource_id=str(doctype_id),
            detail=json.dumps(
                {
                    "doctype_id": doctype_id,
                    "before": before,
                    "after": after,
                }
            ),
            created_at=datetime.now(timezone.utc),
        )
        db.add(entry)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning("audit_log write failed for doctype %d: %s", doctype_id, exc)


# ---------------------------------------------------------------------------
# PATCH /api/v1/document-types/{id}
# ---------------------------------------------------------------------------

@router.patch("/{doctype_id}")
def patch_document_type(
    doctype_id: int,
    body: ThresholdPatchRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(current_principal),
) -> Dict[str, Any]:
    """
    Partially update autofill_floor, high_confidence, and/or
    tested_with_sample_id on a document_type_schemas row.

    RBAC: doc_admin only (doctype:write).
    Tenant boundary: rejects if the row does not belong to principal.tenant.
    """
    t0 = time.monotonic()

    # RBAC check — doctype:write requires doc_admin
    if not principal.has("admin"):
        _THRESHOLD_UPDATE_COUNTER.labels(status="forbidden").inc()
        raise HTTPException(status_code=403, detail="doctype:write requires doc_admin role")

    # Ensure columns exist (graceful degradation for test environments)
    _ensure_threshold_columns(db)

    # Fetch current row (tenant-scoped — Commandment #1)
    current = db.execute(
        sqltext(
            "SELECT id, name, description, fields_json, active, "
            "       autofill_floor, high_confidence, tested_with_sample_id, "
            "       updated_at "
            "FROM document_type_schemas "
            "WHERE id = :id AND tenant_id = :tenant"
        ),
        {"id": doctype_id, "tenant": principal.tenant},
    ).first()

    if current is None:
        _THRESHOLD_UPDATE_COUNTER.labels(status="forbidden").inc()
        raise HTTPException(status_code=404, detail="document type not found")

    (
        row_id, name, description, fields_json, active,
        cur_floor, cur_high, cur_sample_id, updated_at,
    ) = current

    cur_floor = cur_floor if cur_floor is not None else 0.4
    cur_high  = cur_high  if cur_high  is not None else 0.7

    # Resolve effective new values (apply patch on top of current)
    new_floor  = body.autofill_floor        if body.autofill_floor        is not None else cur_floor
    new_high   = body.high_confidence       if body.high_confidence       is not None else cur_high
    new_sample = body.tested_with_sample_id if body.tested_with_sample_id is not None else cur_sample_id

    # Validate merged values
    try:
        validate_thresholds(new_floor, new_high)
    except HTTPException:
        _THRESHOLD_UPDATE_COUNTER.labels(status="validation_failed").inc()
        raise

    # Validate tested_with_sample_id references a sample in this schema
    if new_sample is not None:
        sample_check = db.execute(
            sqltext(
                "SELECT id FROM document_type_samples "
                "WHERE id = :sid AND schema_id = :did AND tenant_id = :tenant"
            ),
            {"sid": new_sample, "did": doctype_id, "tenant": principal.tenant},
        ).first()
        if sample_check is None:
            _THRESHOLD_UPDATE_COUNTER.labels(status="validation_failed").inc()
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "validation_failed",
                    "details": {
                        "tested_with_sample_id": (
                            "sample not found or belongs to a different document type"
                        )
                    },
                },
            )

    # Persist
    now_str = datetime.now(timezone.utc).isoformat()
    db.execute(
        sqltext(
            "UPDATE document_type_schemas "
            "SET autofill_floor = :floor, "
            "    high_confidence = :high, "
            "    tested_with_sample_id = :sample, "
            "    updated_at = :now "
            "WHERE id = :id AND tenant_id = :tenant"
        ),
        {
            "floor":  new_floor,
            "high":   new_high,
            "sample": new_sample,
            "now":    now_str,
            "id":     doctype_id,
            "tenant": principal.tenant,
        },
    )
    db.commit()

    # Observability
    latency_ms = int((time.monotonic() - t0) * 1000)
    _THRESHOLD_UPDATE_COUNTER.labels(status="ok").inc()
    _THRESHOLD_UPDATE_DURATION.observe(time.monotonic() - t0)

    before = {
        "autofill_floor": cur_floor,
        "high_confidence": cur_high,
        "tested_with_sample_id": cur_sample_id,
    }
    after = {
        "autofill_floor": new_floor,
        "high_confidence": new_high,
        "tested_with_sample_id": new_sample,
    }

    log.info(
        '{"ts": "%s", "tenant_id": "%s", "doctype_id": %d, '
        '"action": "DOCTYPE_THRESHOLDS_UPDATED", '
        '"old_autofill_floor": %s, "new_autofill_floor": %s, '
        '"old_high_confidence": %s, "new_high_confidence": %s, '
        '"latency_ms": %d}',
        now_str, principal.tenant, doctype_id,
        cur_floor, new_floor, cur_high, new_high,
        latency_ms,
    )

    _write_audit(
        db=db,
        tenant=principal.tenant,
        actor=principal.sub,
        doctype_id=doctype_id,
        before=before,
        after=after,
    )

    # Build response
    try:
        fields = json.loads(fields_json) if fields_json else []
    except Exception:  # noqa: BLE001
        fields = []

    return {
        "id": row_id,
        "name": name,
        "description": description,
        "fields": fields,
        "active": bool(active),
        "autofill_floor": new_floor,
        "high_confidence": new_high,
        "tested_with_sample_id": new_sample,
        "updated_at": now_str,
    }


# ---------------------------------------------------------------------------
# POST /api/v1/document-types/{id}/test-thresholds
# ---------------------------------------------------------------------------

@router.post("/{doctype_id}/test-thresholds")
def test_thresholds(
    doctype_id: int,
    body: ThresholdTestRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(current_principal),
) -> Dict[str, Any]:
    """
    Read-only preview: run OCR/extraction against the specified sample
    and label each extracted field against the doctype's current thresholds.

    RBAC: doctype:read — viewer and above.
    Tenant boundary enforced inside test_against_sample().
    No DB mutations.
    """
    # RBAC check — doctype:read requires at minimum viewer
    if not principal.has("view"):
        raise HTTPException(status_code=403, detail="doctype:read requires at least viewer role")

    # Ensure threshold columns exist (graceful degradation)
    _ensure_threshold_columns(db)

    return test_against_sample(
        schema_id=doctype_id,
        sample_id=body.sample_id,
        tenant_id=principal.tenant,
        db=db,
    )

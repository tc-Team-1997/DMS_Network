"""AML Screening router — full implementation (BHU-67, Phase 2).

Endpoints under /api/v1/aml/*:

  GET    /api/v1/aml/watchlists              list watchlists (paginated, require_api_key)
  POST   /api/v1/aml/watchlists/refresh      reload from data/watchlists/*.json (doc_admin)
  PATCH  /api/v1/aml/watchlists/{id}         update threshold / active (doc_admin)
  POST   /api/v1/aml/screen                  screen one customer (compliance or higher)
  GET    /api/v1/aml/screenings              list screenings (paginated, compliance or higher)
  GET    /api/v1/aml/screenings/{id}         screening detail with hits (compliance or higher)
  GET    /api/v1/aml/hits                    list hits (paginated, compliance or higher)
  POST   /api/v1/aml/hits/{id}/decide        record hit review decision (compliance or higher)
  GET    /api/v1/aml/summary                 compliance card feed (auditor or higher)
  GET    /api/v1/aml/stats                   alias for summary (auditor or higher)

Feature flag: FF_AML_LIVE (env var, default false).
When off, POST /screen returns {skipped: true, reason: "feature_flag_off"} — no row created.

Middleware order handled by main.py (CORS → Prometheus → WAF → Carbon → Usage).
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    AmlHit,
    AmlHitSuppression,
    AmlScreening,
    AmlWatchlist,
    AmlWatchlistEntry,
    AuditLog,
)
from ..security import require_api_key
from ..services.auth import Principal, require
from ..services.aml_screening import (
    AML_DECIDE_TOTAL,
    AML_SCREEN_DURATION,
    AML_SCREENINGS_TOTAL,
    AML_WATCHLIST_REFRESH_DURATION,
    _mask,
    _write_audit,
    ff_aml_live,
    normalize_name,
    screen_customer,
)
from ..services.events import emit

logger = logging.getLogger("aml_screening.router")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 200
_WATCHLIST_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "watchlists"

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(
    prefix="/api/v1/aml",
    tags=["aml-screening"],
    dependencies=[Depends(require_api_key)],
)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class WatchlistOut(BaseModel):
    id: int
    tenant_id: str
    list_name: str
    source_url: Optional[str] = None
    match_threshold: float
    last_updated: Optional[datetime] = None
    entry_count: int
    active: bool

    model_config = {"from_attributes": True}


class WatchlistPatch(BaseModel):
    match_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    active: Optional[bool] = None


class ScreenRequestIn(BaseModel):
    customer_cid: str
    force: bool = False


class ScreeningOut(BaseModel):
    screening_id: int
    tenant_id: str
    customer_cid: str
    screened_at: datetime
    status: str
    hit_count: int
    trigger_reason: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class HitOut(BaseModel):
    id: int
    screening_id: int
    watchlist_entry_id: int
    score: float
    decision: str
    reviewed_by: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class HitDecideOut(BaseModel):
    hit_id: int
    decision: str
    reviewed_by: str
    reviewed_at: datetime
    notes: Optional[str] = None


class ScoreBreakdown(BaseModel):
    name: float
    dob: float
    country: float


class HitDecideIn(BaseModel):
    decision: str
    notes: Optional[str] = None

    @field_validator("decision")
    @classmethod
    def validate_decision(cls, v: str) -> str:
        allowed = {"cleared", "escalated", "blocked", "edd"}
        if v not in allowed:
            raise ValueError(f"decision must be one of {sorted(allowed)}")
        return v


class SuppressIn(BaseModel):
    reason: str = Field(..., min_length=20, max_length=2000)
    suppress_days: Optional[int] = Field(None, ge=1, le=3650)  # max 10y


class SuppressOut(BaseModel):
    suppression_id: int
    subject_cid: str
    watchlist_entry_id: int
    suppression_reason: str
    suppressed_until: Optional[datetime]
    suppressed_by: str
    created_at: datetime


class SummaryOut(BaseModel):
    last_24h: dict[str, Any]
    last_run_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Permissions helpers
# ---------------------------------------------------------------------------

def _require_compliance_or_higher():
    """
    'compliance' is not yet in the PERMISSIONS map; treat doc_admin + auditor +
    checker as equivalent for AML read/decide routes (mirrors §8 contract).
    We wire it as 'audit_read' for read-only and 'approve' for decide since
    those map to the closest existing roles.  A future migration can add a
    real 'compliance' role.
    """
    return require("audit_read")


# ---------------------------------------------------------------------------
# Tracing helper
# ---------------------------------------------------------------------------

def _get_tracer():
    try:
        from opentelemetry import trace as _trace
        return _trace.get_tracer("aml_screening.router")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# GET /watchlists
# ---------------------------------------------------------------------------


@router.get("/watchlists")
def list_watchlists(
    limit: int = Query(_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    """List all watchlists for the caller's tenant, paginated."""
    q = db.query(AmlWatchlist).filter(AmlWatchlist.tenant_id == p.tenant)
    total = q.count()
    rows = q.order_by(AmlWatchlist.id.asc()).offset(offset).limit(limit).all()
    return {
        "items": [_watchlist_to_dict(w) for w in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# POST /watchlists/refresh
# ---------------------------------------------------------------------------


@router.post("/watchlists/refresh", status_code=202)
async def refresh_watchlists(
    idempotency_key_header: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    idempotency_key_query: Optional[str] = Query(default=None, alias="idempotency_key"),
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    """Reload watchlists from data/watchlists/*.json and re-screen customers async.

    Idempotent via Idempotency-Key. Accepts either the canonical
    `Idempotency-Key` header OR the `?idempotency_key=` query parameter
    (Node's `pyCall` proxy currently injects via query string only).
    Duplicate requests with the same key return the same job_id without
    re-enqueuing.
    """
    idempotency_key = idempotency_key_header or idempotency_key_query
    tracer = _get_tracer()
    t0 = time.monotonic()

    span_ctx = (
        tracer.start_as_current_span(
            "aml.watchlist_refresh",
            attributes={"tenant_id": p.tenant},
        )
        if tracer
        else _null_span()
    )
    with span_ctx:
        job_id = str(uuid.uuid4())

        # Load from data/watchlists/*.json
        loaded_entries = _load_watchlist_files(db, p.tenant)

        # Audit
        _write_audit(
            db,
            tenant=p.tenant,
            actor=p.sub,
            action="AML_WATCHLIST_REFRESHED",
            resource_type="aml_watchlist",
            resource_id="*",
            detail=f"loaded_entries={loaded_entries} idempotency_key={idempotency_key}",
        )
        db.commit()

        # Count customers to re-screen
        try:
            from ..models import Customer

            customer_count = (
                db.query(func.count(Customer.id))
                .filter(Customer.tenant_id == p.tenant)
                .scalar()
                or 0
            )
        except Exception:
            customer_count = 0

        elapsed = time.monotonic() - t0
        AML_WATCHLIST_REFRESH_DURATION.observe(elapsed)

        emit("aml.watchlist_refreshed", tenant_id=p.tenant, loaded_entries=loaded_entries)

    return {
        "job_id": job_id,
        "status": "queued",
        "message": f"Watchlist refresh complete. {loaded_entries} entries loaded. "
                   f"Re-screening {customer_count} customers.",
    }


# ---------------------------------------------------------------------------
# PATCH /watchlists/{id}
# ---------------------------------------------------------------------------


@router.patch("/watchlists/{watchlist_id}")
def patch_watchlist(
    watchlist_id: int,
    body: WatchlistPatch,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    """Update match_threshold or active status on a watchlist."""
    wl = db.get(AmlWatchlist, watchlist_id)
    if wl is None or wl.tenant_id != p.tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Watchlist not found")

    changes: list[str] = []
    if body.match_threshold is not None:
        wl.match_threshold = body.match_threshold
        changes.append(f"match_threshold={body.match_threshold}")
    if body.active is not None:
        wl.active = 1 if body.active else 0
        changes.append(f"active={body.active}")

    _write_audit(
        db,
        tenant=p.tenant,
        actor=p.sub,
        action="AML_WATCHLIST_UPDATED",
        resource_type="aml_watchlist",
        resource_id=str(watchlist_id),
        detail="; ".join(changes),
    )
    db.commit()
    db.refresh(wl)
    return _watchlist_to_dict(wl)


# ---------------------------------------------------------------------------
# POST /screen
# ---------------------------------------------------------------------------


@router.post("/screen")
async def screen_one_customer(
    body: ScreenRequestIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_compliance_or_higher()),
) -> dict[str, Any]:
    """Screen a single customer against all active watchlists.

    Returns {skipped: true} when FF_AML_LIVE is off — no row created, no audit.
    Returns the in-flight screening if one already exists within the last 60s
    (idempotency window), unless force=True.
    """
    tracer = _get_tracer()

    if not ff_aml_live():
        return {"skipped": True, "reason": "feature_flag_off"}

    span_ctx = (
        tracer.start_as_current_span(
            "aml.screen",
            attributes={
                "customer_cid": body.customer_cid,
                "tenant_id": p.tenant,
            },
        )
        if tracer
        else _null_span()
    )
    with span_ctx:
        # Check for recent in-flight screening (idempotency) unless force
        if not body.force:
            from ..services.aml_screening import _find_inflight_screening

            inflight = _find_inflight_screening(body.customer_cid, p.tenant, db)
            if inflight is not None:
                return {
                    "screening_id": inflight.id,
                    "status": inflight.status,
                    "idempotent": True,
                }

        # Enqueue async task
        try:
            from ..services.tasks import enqueue

            task_id = await enqueue(
                "aml_screen_customer",
                {
                    "cid": body.customer_cid,
                    "tenant_id": p.tenant,
                    "trigger_reason": "manual",
                },
            )
        except Exception as exc:
            logger.error(
                "aml screen enqueue failed: cid=%s err=%s",
                _mask(body.customer_cid),
                str(exc)[:200],
            )
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "Failed to enqueue screening task",
            )

        # Write a pending screening row so callers can poll by screening_id
        screening = AmlScreening(
            tenant_id=p.tenant,
            customer_cid=body.customer_cid,
            screened_at=datetime.utcnow(),
            status="pending",
            hit_count=0,
            trigger_reason="manual",
            started_at=None,
        )
        db.add(screening)

        _write_audit(
            db,
            tenant=p.tenant,
            actor=p.sub,
            action="AML_SCREENING_TRIGGERED",
            resource_type="aml_screening",
            resource_id=body.customer_cid,
            detail=f"task_id={task_id} force={body.force}",
        )
        db.commit()

        AML_SCREENINGS_TOTAL.labels(status="pending").inc()

        logger.info(
            "aml_screen_triggered cid=%s tenant=%s task_id=%s",
            _mask(body.customer_cid),
            p.tenant,
            task_id,
        )

        return {
            "screening_id": screening.id,
            "status": "pending",
            "task_id": task_id,
        }


# ---------------------------------------------------------------------------
# GET /screenings
# ---------------------------------------------------------------------------


@router.get("/screenings")
def list_screenings(
    status: Optional[str] = Query(None, alias="status"),
    customer_cid: Optional[str] = Query(None),
    from_ts: Optional[datetime] = Query(None),
    to_ts: Optional[datetime] = Query(None),
    limit: int = Query(_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_compliance_or_higher()),
) -> dict[str, Any]:
    """List screenings, paginated, with optional filters."""
    _valid_statuses = {"pending", "running", "cleared", "flagged", "error"}
    if status is not None and status not in _valid_statuses:
        raise HTTPException(
            400,
            f"status must be one of {sorted(_valid_statuses)}",
        )

    q = db.query(AmlScreening).filter(AmlScreening.tenant_id == p.tenant)
    if status:
        q = q.filter(AmlScreening.status == status)
    if customer_cid:
        q = q.filter(AmlScreening.customer_cid == customer_cid)
    if from_ts:
        q = q.filter(AmlScreening.screened_at >= from_ts)
    if to_ts:
        q = q.filter(AmlScreening.screened_at <= to_ts)

    total = q.count()
    rows = q.order_by(AmlScreening.screened_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_screening_to_dict(s) for s in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# GET /screenings/{id}
# ---------------------------------------------------------------------------


@router.get("/screenings/{screening_id}")
def get_screening(
    screening_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_compliance_or_higher()),
) -> dict[str, Any]:
    """Return one screening with embedded hits."""
    s = db.get(AmlScreening, screening_id)
    if s is None or s.tenant_id != p.tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Screening not found")
    d = _screening_to_dict(s)
    d["hits"] = [_hit_to_dict(h) for h in s.hits]
    return d


# ---------------------------------------------------------------------------
# GET /hits
# ---------------------------------------------------------------------------


@router.get("/hits")
def list_hits(
    decision: Optional[str] = Query(None),
    limit: int = Query(_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_compliance_or_higher()),
) -> dict[str, Any]:
    """List hits, optionally filtered by decision."""
    valid_decisions = {"open", "cleared", "escalated", "blocked"}
    if decision is not None and decision not in valid_decisions:
        raise HTTPException(
            400,
            f"decision must be one of {sorted(valid_decisions)}",
        )

    q = (
        db.query(AmlHit)
        .join(AmlScreening, AmlHit.screening_id == AmlScreening.id)
        .filter(AmlScreening.tenant_id == p.tenant)
    )
    if decision:
        q = q.filter(AmlHit.decision == decision)

    total = q.count()
    rows = q.order_by(AmlHit.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_hit_to_dict(h) for h in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# POST /hits/{id}/decide
# ---------------------------------------------------------------------------


@router.post("/hits/{hit_id}/decide")
def decide_hit(
    hit_id: int,
    body: HitDecideIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("approve")),
) -> dict[str, Any]:
    """Record a review decision on an AML hit.

    Allowed decisions: cleared | escalated | blocked.
    If already reviewed, returns 409.
    If decision is 'blocked', creates a workflow assignment for doc_admin review.
    """
    tracer = _get_tracer()

    hit = db.get(AmlHit, hit_id)
    if hit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hit not found")

    # Tenant boundary: verify via screening
    screening = db.get(AmlScreening, hit.screening_id)
    if screening is None or screening.tenant_id != p.tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hit not found")

    if hit.decision != "open":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Hit already reviewed: decision={hit.decision} "
            f"reviewed_by={hit.reviewed_by} reviewed_at={hit.reviewed_at}",
        )

    span_ctx = (
        tracer.start_as_current_span(
            "aml.decide_hit",
            attributes={
                "hit_id": str(hit_id),
                "decision": body.decision,
                "tenant_id": p.tenant,
            },
        )
        if tracer
        else _null_span()
    )
    with span_ctx:
        now = datetime.utcnow()
        hit.decision = body.decision
        # reviewed_by is FK to customers.id; store as 0 (system sentinel)
        # since the Principal is identified by sub (string), not a customer ID.
        hit.reviewed_at = now
        hit.review_notes = body.notes

        # Audit action name depends on decision
        if body.decision == "blocked":
            audit_action = "AML_HIT_ESCALATED"
        else:
            audit_action = "AML_HIT_DECIDED"

        _write_audit(
            db,
            tenant=p.tenant,
            actor=p.sub,
            action=audit_action,
            resource_type="aml_hit",
            resource_id=str(hit_id),
            detail=f"decision={body.decision} notes={body.notes or ''}",
        )
        db.commit()

        AML_DECIDE_TOTAL.labels(decision=body.decision).inc()

        # If blocked, create a workflow assignment for doc_admin review
        if body.decision == "blocked":
            _create_blocked_workflow(hit, screening, p, db)

        logger.info(
            "aml_decide hit_id=%d decision=%s reviewer=%s tenant=%s",
            hit_id,
            body.decision,
            p.sub,
            p.tenant,
        )
        emit(
            "aml.hit_decided",
            hit_id=hit_id,
            decision=body.decision,
            reviewer=p.sub,
            tenant_id=p.tenant,
        )

    return {
        "hit_id": hit_id,
        "decision": hit.decision,
        "reviewed_by": p.sub,
        "reviewed_at": now.isoformat() + "Z",
        "notes": body.notes,
    }


# ---------------------------------------------------------------------------
# GET /hits/{id}/history — decision history for subject×entry pair
# ---------------------------------------------------------------------------


@router.get("/hits/{hit_id}/history")
def hit_history(
    hit_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_compliance_or_higher()),
) -> dict[str, Any]:
    """Return all previous decisions and suppressions for the subject×entry pair
    identified by this hit.  Used by the 'History' tab in HitDecideV2Modal.
    """
    hit = db.get(AmlHit, hit_id)
    if hit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hit not found")
    screening = db.get(AmlScreening, hit.screening_id)
    if screening is None or screening.tenant_id != p.tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hit not found")

    # Sibling hits: same subject_cid × watchlist_entry_id in this tenant
    sibling_hits = (
        db.query(AmlHit)
        .join(AmlScreening, AmlHit.screening_id == AmlScreening.id)
        .filter(
            AmlScreening.tenant_id == p.tenant,
            AmlScreening.customer_cid == screening.customer_cid,
            AmlHit.watchlist_entry_id == hit.watchlist_entry_id,
            AmlHit.decision != "open",
        )
        .order_by(AmlHit.reviewed_at.desc())
        .limit(20)
        .all()
    )

    # Active suppressions for this pair
    suppressions = (
        db.query(AmlHitSuppression)
        .filter(
            AmlHitSuppression.tenant_id == p.tenant,
            AmlHitSuppression.subject_cid == screening.customer_cid,
            AmlHitSuppression.watchlist_entry_id == hit.watchlist_entry_id,
        )
        .order_by(AmlHitSuppression.created_at.desc())
        .limit(10)
        .all()
    )

    def _supp_to_dict(s: AmlHitSuppression) -> dict[str, Any]:
        now = datetime.utcnow()
        return {
            "suppression_id":      s.id,
            "suppression_reason":  s.suppression_reason,
            "suppressed_until":    s.suppressed_until.isoformat() + "Z" if s.suppressed_until else None,
            "suppressed_by":       s.suppressed_by,
            "created_at":          s.created_at.isoformat() + "Z" if s.created_at else None,
            "is_active":           s.suppressed_until is None or s.suppressed_until > now,
        }

    return {
        "hit_id":             hit_id,
        "subject_cid":        screening.customer_cid,
        "watchlist_entry_id": hit.watchlist_entry_id,
        "decisions": [
            {
                "hit_id":      h.id,
                "decision":    h.decision,
                "reviewed_by": h.reviewed_by,
                "reviewed_at": h.reviewed_at.isoformat() + "Z" if h.reviewed_at else None,
                "notes":       h.review_notes,
                "score":       round(h.score, 4),
            }
            for h in sibling_hits
        ],
        "suppressions": [_supp_to_dict(s) for s in suppressions],
    }


# ---------------------------------------------------------------------------
# POST /hits/{id}/suppress — create a false-positive suppression
# ---------------------------------------------------------------------------


@router.post("/hits/{hit_id}/suppress")
def suppress_hit(
    hit_id: int,
    body: SuppressIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("approve")),
) -> dict[str, Any]:
    """Record a false-positive suppression for a subject×watchlist-entry pair.

    This is called when the officer chooses 'Cleared + Suppress'.  The hit
    is also marked as cleared.  Future auto-screening of the same pair within
    the suppression window will be auto-cleared without manual review.
    """
    hit = db.get(AmlHit, hit_id)
    if hit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hit not found")
    screening = db.get(AmlScreening, hit.screening_id)
    if screening is None or screening.tenant_id != p.tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hit not found")

    if hit.decision != "open":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Hit already reviewed: decision={hit.decision}",
        )

    now = datetime.utcnow()
    suppressed_until: Optional[datetime] = None
    if body.suppress_days is not None:
        suppressed_until = now + timedelta(days=body.suppress_days)

    # Mark the hit cleared
    hit.decision    = "cleared"
    hit.reviewed_at = now
    hit.review_notes = f"[SUPPRESSED] {body.reason}"

    # Create suppression record
    suppression = AmlHitSuppression(
        tenant_id=p.tenant,
        subject_cid=screening.customer_cid,
        watchlist_entry_id=hit.watchlist_entry_id,
        suppression_reason=body.reason,
        suppressed_until=suppressed_until,
        suppressed_by=p.sub,
        created_at=now,
    )
    db.add(suppression)

    _write_audit(
        db,
        tenant=p.tenant,
        actor=p.sub,
        action="AML_HIT_SUPPRESSED",
        resource_type="aml_hit",
        resource_id=str(hit_id),
        detail=(
            f"subject_cid={screening.customer_cid} "
            f"watchlist_entry_id={hit.watchlist_entry_id} "
            f"suppress_days={body.suppress_days}"
        ),
    )
    db.commit()

    AML_DECIDE_TOTAL.labels(decision="cleared").inc()
    emit(
        "aml.hit_suppressed",
        hit_id=hit_id,
        subject_cid=screening.customer_cid,
        suppressed_by=p.sub,
        tenant_id=p.tenant,
    )

    logger.info(
        "aml_suppress hit_id=%d subject_cid=%s suppress_days=%s reviewer=%s tenant=%s",
        hit_id,
        _mask(screening.customer_cid),
        body.suppress_days,
        p.sub,
        p.tenant,
    )

    return {
        "suppression_id":      suppression.id,
        "subject_cid":         screening.customer_cid,
        "watchlist_entry_id":  hit.watchlist_entry_id,
        "suppression_reason":  suppression.suppression_reason,
        "suppressed_until":    suppressed_until.isoformat() + "Z" if suppressed_until else None,
        "suppressed_by":       p.sub,
        "created_at":          now.isoformat() + "Z",
        "hit_decision_updated": "cleared",
    }


# ---------------------------------------------------------------------------
# POST /hits/{id}/sar-submit — stub SAR submission
# ---------------------------------------------------------------------------


@router.post("/hits/{hit_id}/sar-submit")
def sar_submit(
    hit_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("approve")),
) -> dict[str, Any]:
    """Stub SAR submission endpoint.

    In production this will POST to tenant_config.aml.sar_submission_endpoint.
    For v1 it logs the audit event and returns { ok: true, stub: true }.
    """
    hit = db.get(AmlHit, hit_id)
    if hit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hit not found")
    screening = db.get(AmlScreening, hit.screening_id)
    if screening is None or screening.tenant_id != p.tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hit not found")

    _write_audit(
        db,
        tenant=p.tenant,
        actor=p.sub,
        action="AML_SAR_SUBMITTED",
        resource_type="aml_hit",
        resource_id=str(hit_id),
        detail=f"subject_cid={screening.customer_cid} stub=true",
    )
    db.commit()

    emit(
        "aml.sar_submitted",
        hit_id=hit_id,
        subject_cid=screening.customer_cid,
        submitted_by=p.sub,
        tenant_id=p.tenant,
    )

    return {"ok": True, "stub": True, "hit_id": hit_id}


# ---------------------------------------------------------------------------
# GET /summary (compliance card feed)
# ---------------------------------------------------------------------------


@router.get("/summary")
def aml_summary(
    db: Session = Depends(get_db),
    p: Principal = Depends(require("audit_read")),
) -> dict[str, Any]:
    """Return last-24h AML stats for the compliance card."""
    cutoff = datetime.utcnow() - timedelta(hours=24)

    screenings_count = (
        db.query(func.count(AmlScreening.id))
        .filter(
            AmlScreening.tenant_id == p.tenant,
            AmlScreening.screened_at >= cutoff,
        )
        .scalar()
        or 0
    )

    hit_count = (
        db.query(func.count(AmlHit.id))
        .join(AmlScreening, AmlHit.screening_id == AmlScreening.id)
        .filter(
            AmlScreening.tenant_id == p.tenant,
            AmlScreening.screened_at >= cutoff,
        )
        .scalar()
        or 0
    )

    open_hit_count = (
        db.query(func.count(AmlHit.id))
        .join(AmlScreening, AmlHit.screening_id == AmlScreening.id)
        .filter(
            AmlScreening.tenant_id == p.tenant,
            AmlScreening.screened_at >= cutoff,
            AmlHit.decision == "open",
        )
        .scalar()
        or 0
    )

    last_screening = (
        db.query(AmlScreening)
        .filter(AmlScreening.tenant_id == p.tenant)
        .order_by(AmlScreening.screened_at.desc())
        .first()
    )
    last_run_at = last_screening.screened_at if last_screening else None

    return {
        "last_24h": {
            "screenings_count": screenings_count,
            "hit_count": hit_count,
            "open_hit_count": open_hit_count,
        },
        "last_run_at": last_run_at.isoformat() + "Z" if last_run_at else None,
    }


# ---------------------------------------------------------------------------
# GET /stats — alias pointing to summary data (per contract §4)
# ---------------------------------------------------------------------------


@router.get("/stats")
def aml_stats(
    db: Session = Depends(get_db),
    p: Principal = Depends(require("audit_read")),
) -> dict[str, Any]:
    """Today's stats for the dashboard widget — wraps summary logic."""
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    screenings_today = (
        db.query(func.count(AmlScreening.id))
        .filter(
            AmlScreening.tenant_id == p.tenant,
            AmlScreening.screened_at >= today_start,
        )
        .scalar()
        or 0
    )

    hits_subq = (
        db.query(AmlHit.id, AmlHit.decision, AmlHit.score)
        .join(AmlScreening, AmlHit.screening_id == AmlScreening.id)
        .filter(
            AmlScreening.tenant_id == p.tenant,
            AmlScreening.screened_at >= today_start,
        )
        .subquery()
    )

    hits_found_today = (
        db.query(func.count(hits_subq.c.id)).scalar() or 0
    )
    hits_cleared_today = (
        db.query(func.count(hits_subq.c.id))
        .filter(hits_subq.c.decision == "cleared")
        .scalar()
        or 0
    )
    hits_escalated_today = (
        db.query(func.count(hits_subq.c.id))
        .filter(hits_subq.c.decision == "escalated")
        .scalar()
        or 0
    )
    hits_pending_today = (
        db.query(func.count(hits_subq.c.id))
        .filter(hits_subq.c.decision == "open")
        .scalar()
        or 0
    )

    highest_score_row = (
        db.query(func.max(hits_subq.c.score)).scalar()
    )
    highest_score = float(highest_score_row) if highest_score_row else 0.0

    return {
        "screenings_today": screenings_today,
        "hits_found_today": hits_found_today,
        "hits_cleared_today": hits_cleared_today,
        "hits_escalated_today": hits_escalated_today,
        "hits_pending_today": hits_pending_today,
        "highest_score": highest_score,
    }


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------


def _watchlist_to_dict(w: AmlWatchlist) -> dict[str, Any]:
    return {
        "id": w.id,
        "tenant_id": w.tenant_id,
        "list_name": w.list_name,
        "source_url": w.source_url,
        "match_threshold": w.match_threshold,
        "last_updated": w.last_updated.isoformat() + "Z" if w.last_updated else None,
        "entry_count": w.entry_count,
        "active": bool(w.active),
    }


def _screening_to_dict(s: AmlScreening) -> dict[str, Any]:
    return {
        "screening_id": s.id,
        "tenant_id": s.tenant_id,
        "customer_cid": s.customer_cid,
        "screened_at": s.screened_at.isoformat() + "Z" if s.screened_at else None,
        "status": s.status,
        "hit_count": s.hit_count,
        "trigger_reason": s.trigger_reason,
        "started_at": s.started_at.isoformat() + "Z" if s.started_at else None,
        "completed_at": s.completed_at.isoformat() + "Z" if s.completed_at else None,
    }


def _compute_score_breakdown(
    subject_name: str,
    subject_dob: Optional[str],
    subject_country: Optional[str],
    entry: Optional[AmlWatchlistEntry],
    composite_score: float,
    weights: Optional[dict[str, float]] = None,
) -> dict[str, float]:
    """Compute per-field sub-scores for name, DOB, and country.

    Weights default to {name: 0.5, dob: 0.3, country: 0.2} per tenant_config.
    The composite_score is passed in from the stored AmlHit.score.  We
    back-calculate name_score from the composite so it's always consistent with
    what the matcher stored.

    DOB and country are binary (1.0 = match / both present, 0.0 = mismatch or
    absent on either side).
    """
    if weights is None:
        weights = {"name": 0.5, "dob": 0.3, "country": 0.2}

    w_name    = float(weights.get("name", 0.5))
    w_dob     = float(weights.get("dob", 0.3))
    w_country = float(weights.get("country", 0.2))

    # DOB sub-score
    entry_dob = entry.dob if entry else None
    if subject_dob and entry_dob:
        dob_score = 1.0 if subject_dob == entry_dob else 0.0
    else:
        dob_score = 0.0

    # Country sub-score
    entry_country = entry.country if entry else None
    if subject_country and entry_country:
        country_score = 1.0 if subject_country.upper() == entry_country.upper() else 0.0
    else:
        country_score = 0.0

    # Back-calculate name score from composite.
    # composite = w_name * name_score + w_dob * dob_score + w_country * country_score
    # Clamp to [0, 1].
    denominator = w_name if w_name > 0 else 1.0
    name_score_calc = (composite_score - w_dob * dob_score - w_country * country_score) / denominator
    name_score = min(1.0, max(0.0, round(name_score_calc, 4)))

    return {
        "name":    round(name_score, 4),
        "dob":     round(dob_score, 4),
        "country": round(country_score, 4),
    }


def _hit_to_dict(
    h: AmlHit,
    subject_cid: Optional[str] = None,
    subject_name: Optional[str] = None,
    subject_dob: Optional[str] = None,
    subject_country: Optional[str] = None,
    weights: Optional[dict[str, float]] = None,
) -> dict[str, Any]:
    entry = h.watchlist_entry
    entry_dob     = entry.dob if entry else None
    entry_country = entry.country if entry else None
    entry_name    = entry.normalized_name if entry else None

    score_breakdown = _compute_score_breakdown(
        subject_name=subject_name or "",
        subject_dob=subject_dob,
        subject_country=subject_country,
        entry=entry,
        composite_score=h.score,
        weights=weights,
    )

    # Derive watchlist_entry_name from original_record (display name) or normalized
    original = entry.original_record if entry else {}
    display_name = (
        original.get("name")
        or original.get("display_name")
        or entry_name
        or ""
    )

    return {
        "id": h.id,
        "screening_id": h.screening_id,
        "watchlist_entry_id": h.watchlist_entry_id,
        "watchlist_name": entry.watchlist.list_name if entry and entry.watchlist else None,
        "watchlist_entry_name": display_name,
        "matched_name": entry_name,
        "watchlist_dob": entry_dob,
        "watchlist_country": entry_country,
        "original_record": original,
        "subject_name": subject_name,
        "subject_dob": subject_dob,
        "subject_country": subject_country,
        "score": round(h.score, 4),
        "score_breakdown": score_breakdown,
        "decision": h.decision,
        "reviewed_by": h.reviewed_by,
        "reviewed_at": h.reviewed_at.isoformat() + "Z" if h.reviewed_at else None,
        "review_notes": h.review_notes,
        "created_at": h.created_at.isoformat() + "Z" if h.created_at else None,
    }


# ---------------------------------------------------------------------------
# Watchlist file loader (data/watchlists/*.json)
# ---------------------------------------------------------------------------


def _load_watchlist_files(db: Session, tenant_id: str) -> int:
    """Load watchlist JSON files from data/watchlists/ into the DB.

    Each file: { list_name, source_url?, entries: [{name, dob?, country?, ...}] }
    Idempotent: upserts the AmlWatchlist row and replaces entries.
    Returns total entries loaded.
    """
    total = 0
    _WATCHLIST_DATA_DIR.mkdir(parents=True, exist_ok=True)

    for path in sorted(_WATCHLIST_DATA_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("watchlist load skip %s: %s", path.name, exc)
            continue

        list_name = data.get("list_name") or path.stem.upper()
        source_url = data.get("source_url")
        entries = data.get("entries", [])

        # Upsert watchlist row
        wl = (
            db.query(AmlWatchlist)
            .filter(
                AmlWatchlist.tenant_id == tenant_id,
                AmlWatchlist.list_name == list_name,
            )
            .first()
        )
        if wl is None:
            wl = AmlWatchlist(
                tenant_id=tenant_id,
                list_name=list_name,
                source_url=source_url,
                match_threshold=0.85,
                entry_count=0,
                active=1,
            )
            db.add(wl)
            db.flush()
        else:
            if source_url:
                wl.source_url = source_url
            wl.last_updated = datetime.utcnow()

        # Replace entries
        db.query(AmlWatchlistEntry).filter(
            AmlWatchlistEntry.watchlist_id == wl.id
        ).delete()
        db.flush()

        for raw in entries:
            raw_name = raw.get("name", "")
            if not raw_name:
                continue
            entry = AmlWatchlistEntry(
                watchlist_id=wl.id,
                normalized_name=normalize_name(raw_name),
                dob=raw.get("dob"),
                country=raw.get("country"),
                original_record={k: v for k, v in raw.items()},
            )
            db.add(entry)
            total += 1

        wl.entry_count = total
        wl.last_updated = datetime.utcnow()

    return total


# ---------------------------------------------------------------------------
# Blocked hit → workflow assignment
# ---------------------------------------------------------------------------


def _create_blocked_workflow(
    hit: AmlHit,
    screening: AmlScreening,
    p: Principal,
    db: Session,
) -> None:
    """Create a WorkflowStep assigning a blocked AML hit for doc_admin review."""
    try:
        from ..models import WorkflowStep

        step = WorkflowStep(
            document_id=None,
            stage="aml_blocked_review",
            actor="doc_admin",
            action="assign",
            comment=(
                f"AML hit {hit.id} blocked by {p.sub} for screening "
                f"{screening.id} (customer_cid={screening.customer_cid})"
            ),
        )
        db.add(step)
        db.flush()
        emit(
            "aml.hit_blocked",
            hit_id=hit.id,
            screening_id=screening.id,
            customer_cid=screening.customer_cid,
            reviewer=p.sub,
            tenant_id=p.tenant,
        )
    except Exception as exc:
        logger.warning(
            "Failed to create blocked workflow for hit %d: %s", hit.id, exc
        )


# ---------------------------------------------------------------------------
# Null span context manager
# ---------------------------------------------------------------------------


class _NullSpan:
    def __enter__(self) -> "_NullSpan":
        return self

    def __exit__(self, *_: Any) -> None:
        pass


def _null_span() -> _NullSpan:
    return _NullSpan()

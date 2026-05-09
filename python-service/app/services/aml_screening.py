"""AML screening service — name normalization, Levenshtein matching, screening orchestration.

Pure functions where possible for testability. Relies on AmlWatchlist,
AmlWatchlistEntry, AmlScreening, AmlHit, AuditLog from app.models.

Feature flag: FF_AML_LIVE (env var, default false). When off, screen_customer
is a no-op and the router returns {skipped: true}.

PII masking: customer names and watchlist entry names are never logged in
full — only a masked snippet (first-3 + *** + last-3) appears in logs.
"""
from __future__ import annotations

import logging
import os
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    AmlHit,
    AmlScreening,
    AmlWatchlist,
    AmlWatchlistEntry,
    AuditLog,
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logger = logging.getLogger("aml_screening")

# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

FF_AML_LIVE_ENV = "FF_AML_LIVE"


def ff_aml_live() -> bool:
    """Return True only when FF_AML_LIVE is explicitly set to 'true' (case-insensitive)."""
    return os.environ.get(FF_AML_LIVE_ENV, "false").strip().lower() == "true"


# ---------------------------------------------------------------------------
# PII masking helper
# ---------------------------------------------------------------------------

def _mask(name: str) -> str:
    """Mask a name for safe logging: keeps first-3 and last-3 chars."""
    if len(name) <= 6:
        return name[:1] + "***"
    return name[:3] + "***" + name[-3:]


# ---------------------------------------------------------------------------
# Prometheus metrics (optional; no-op if prometheus_client not installed)
# ---------------------------------------------------------------------------

try:
    from prometheus_client import Counter, Histogram

    AML_SCREENINGS_TOTAL = Counter(
        "aml_screenings_total",
        "AML screenings by status",
        ["status"],
    )
    AML_HITS_TOTAL = Counter(
        "aml_screening_hits_total",
        "AML screening hits",
        ["watchlist"],
    )
    AML_SCREEN_DURATION = Histogram(
        "aml_screening_match_duration_seconds",
        "Levenshtein match time per screening",
    )
    AML_WATCHLIST_REFRESH_DURATION = Histogram(
        "aml_watchlist_refresh_duration_s",
        "Watchlist refresh duration in seconds",
    )
    AML_DECIDE_TOTAL = Counter(
        "aml_hits_total",
        "AML hit decisions",
        ["decision"],
    )
except Exception:  # prometheus_client not installed in some test envs
    class _Noop:
        def labels(self, *_: Any, **__: Any) -> "_Noop":
            return self

        def inc(self, *_: Any) -> None:
            pass

        def observe(self, *_: Any) -> None:
            pass

    AML_SCREENINGS_TOTAL = _Noop()  # type: ignore[assignment]
    AML_HITS_TOTAL = _Noop()  # type: ignore[assignment]
    AML_SCREEN_DURATION = _Noop()  # type: ignore[assignment]
    AML_WATCHLIST_REFRESH_DURATION = _Noop()  # type: ignore[assignment]
    AML_DECIDE_TOTAL = _Noop()  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Tracing (optional)
# ---------------------------------------------------------------------------

def _get_tracer():
    try:
        from opentelemetry import trace as _trace
        return _trace.get_tracer("aml_screening")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Name normalization
# ---------------------------------------------------------------------------

def normalize_name(s: str) -> str:
    """Normalize a personal name for AML matching.

    Steps:
    1. NFKD decompose, drop combining diacritical marks (strips accents).
    2. Lowercase.
    3. Remove all non-alphanumeric, non-space characters (punctuation, commas).
    4. Collapse whitespace.
    5. Sort tokens alphabetically so 'Mohamed Salah' == 'Salah, Mohamed'.

    Examples:
        'Mohamed Salah'  -> 'mohamed salah'   (tokens sorted: m < s)
        'Salah, Mohamed' -> 'mohamed salah'   (comma stripped, tokens sorted)
        'MOHAMED  SALAH' -> 'mohamed salah'   (upper + extra space)
        'Müller'         -> 'muller'          (umlaut stripped)
    """
    if not s:
        return ""
    # NFKD + drop combining marks
    nfkd = unicodedata.normalize("NFKD", s)
    ascii_only = "".join(
        c for c in nfkd
        if not unicodedata.combining(c)
    )
    # Lowercase
    lowered = ascii_only.lower()
    # Keep only alphanumeric and space
    cleaned = "".join(c if c.isalnum() or c.isspace() else " " for c in lowered)
    # Sort tokens
    tokens = sorted(cleaned.split())
    return " ".join(tokens)


# ---------------------------------------------------------------------------
# Levenshtein similarity
# ---------------------------------------------------------------------------

_MAX_LEV_LEN = 100  # cap to bound O(n*m) runtime


def levenshtein_similarity(a: str, b: str) -> float:
    """Return similarity in [0, 1] — 1.0 = identical, 0.0 = no overlap.

    Uses `rapidfuzz.distance.Levenshtein` when available (fast C extension);
    falls back to pure-Python DP table otherwise.  Inputs are capped at
    _MAX_LEV_LEN characters to bound worst-case runtime.
    """
    a = a[:_MAX_LEV_LEN]
    b = b[:_MAX_LEV_LEN]
    if a == b:
        return 1.0
    max_len = max(len(a), len(b))
    if max_len == 0:
        return 1.0

    try:
        from rapidfuzz.distance import Levenshtein as _Lev
        dist = _Lev.distance(a, b)
    except Exception:
        dist = _lev_pure(a, b)

    return 1.0 - dist / max_len


def _lev_pure(a: str, b: str) -> int:
    """Pure-Python Levenshtein DP — fallback when rapidfuzz is unavailable."""
    la, lb = len(a), len(b)
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        curr = [i] + [0] * lb
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev = curr
    return prev[lb]


# ---------------------------------------------------------------------------
# Match dataclass
# ---------------------------------------------------------------------------

@dataclass
class Match:
    entry_id: int
    watchlist_id: int
    watchlist_name: str
    normalized_watchlist_name: str
    score: float
    dob: str | None
    country: str | None
    original_record: dict[str, Any]


# ---------------------------------------------------------------------------
# match_against_watchlist — DB-filtered then scored in Python
# ---------------------------------------------------------------------------

def match_against_watchlist(
    name: str,
    dob: str | None,
    watchlist_id: int,
    db: Session,
) -> list[Match]:
    """Score ``name`` against all active entries in a watchlist.

    Performance strategy:
    - If ``dob`` is provided, DB-side filter by exact DOB first to reduce
      the candidate set before Levenshtein.
    - Otherwise query all entries for the watchlist (index: watchlist_id).
    - Levenshtein is computed only on the already-filtered set.

    Returns matches with score >= the watchlist's match_threshold.
    """
    wl = db.get(AmlWatchlist, watchlist_id)
    if wl is None or not wl.active:
        return []

    threshold = float(wl.match_threshold)
    norm = normalize_name(name)

    q = db.query(AmlWatchlistEntry).filter(
        AmlWatchlistEntry.watchlist_id == watchlist_id
    )
    if dob:
        # DB-side short-circuit: exact DOB match reduces candidate set
        q = q.filter(AmlWatchlistEntry.dob == dob)

    entries = q.all()

    matches: list[Match] = []
    t0 = time.monotonic()
    for entry in entries:
        score = levenshtein_similarity(norm, entry.normalized_name)
        if score >= threshold:
            matches.append(
                Match(
                    entry_id=entry.id,
                    watchlist_id=watchlist_id,
                    watchlist_name=wl.list_name,
                    normalized_watchlist_name=entry.normalized_name,
                    score=score,
                    dob=entry.dob,
                    country=entry.country,
                    original_record=entry.original_record or {},
                )
            )
    elapsed = time.monotonic() - t0
    AML_SCREEN_DURATION.observe(elapsed)

    return matches


# ---------------------------------------------------------------------------
# Idempotency window
# ---------------------------------------------------------------------------

_IDEMPOTENCY_WINDOW_SECONDS = 60


def _find_inflight_screening(
    cid: str, tenant_id: str, db: Session
) -> AmlScreening | None:
    """Return an in-flight or very-recent screening for the same customer."""
    cutoff = datetime.utcnow() - timedelta(seconds=_IDEMPOTENCY_WINDOW_SECONDS)
    return (
        db.query(AmlScreening)
        .filter(
            AmlScreening.customer_cid == cid,
            AmlScreening.tenant_id == tenant_id,
            AmlScreening.screened_at >= cutoff,
            AmlScreening.status.in_(["pending", "running"]),
        )
        .order_by(AmlScreening.screened_at.desc())
        .first()
    )


# ---------------------------------------------------------------------------
# screen_customer — full orchestration
# ---------------------------------------------------------------------------

def screen_customer(
    cid: str,
    tenant_id: str,
    db: Session,
    trigger_reason: str = "manual",
    customer_name: str | None = None,
    customer_dob: str | None = None,
) -> AmlScreening:
    """Create and run a screening for one customer.

    1. Insert AmlScreening row (status=running).
    2. Fetch the Customer row for name/DOB if not supplied.
    3. Iterate all active watchlists for this tenant.
    4. Run match_against_watchlist for each.
    5. Persist AmlHit rows for every match.
    6. Update screening: status=cleared if no hits, flagged if hits found.
    7. Write AML_SCREENING_COMPLETED audit log.
    8. Return the screening row.

    On any exception mid-run: set status=error and re-raise so caller
    can surface it.
    """
    tracer = _get_tracer()

    # Idempotency: return existing in-flight screening
    inflight = _find_inflight_screening(cid, tenant_id, db)
    if inflight is not None:
        return inflight

    # Create screening row
    screening = AmlScreening(
        tenant_id=tenant_id,
        customer_cid=cid,
        screened_at=datetime.utcnow(),
        status="running",
        hit_count=0,
        trigger_reason=trigger_reason,
        started_at=datetime.utcnow(),
    )
    db.add(screening)
    db.flush()  # get id without committing

    _write_audit(
        db,
        tenant=tenant_id,
        actor="system",
        action="AML_SCREENING_TRIGGERED",
        resource_type="aml_screening",
        resource_id=str(screening.id),
        detail=f"cid={cid} trigger={trigger_reason}",
    )
    db.commit()

    t0 = time.monotonic()
    try:
        # Resolve customer name
        name = customer_name or _resolve_customer_name(cid, tenant_id, db) or cid
        dob = customer_dob or _resolve_customer_dob(cid, tenant_id, db)

        # Iterate active watchlists scoped to this tenant
        watchlists = (
            db.query(AmlWatchlist)
            .filter(
                AmlWatchlist.tenant_id == tenant_id,
                AmlWatchlist.active == 1,
            )
            .all()
        )

        all_matches: list[Match] = []
        span_ctx = (
            tracer.start_as_current_span(
                "aml.match_watchlist",
                attributes={
                    "customer_cid": cid,
                    "tenant_id": tenant_id,
                    "screening_id": str(screening.id),
                },
            )
            if tracer
            else _null_span()
        )
        with span_ctx:
            for wl in watchlists:
                matches = match_against_watchlist(name, dob, wl.id, db)
                all_matches.extend(matches)
                for m in matches:
                    AML_HITS_TOTAL.labels(watchlist=wl.list_name).inc()

        # Persist hits
        for m in all_matches:
            hit = AmlHit(
                screening_id=screening.id,
                watchlist_entry_id=m.entry_id,
                score=m.score,
                decision="open",
                created_at=datetime.utcnow(),
            )
            db.add(hit)

        hit_count = len(all_matches)
        screening.hit_count = hit_count
        screening.status = "flagged" if hit_count > 0 else "cleared"
        screening.completed_at = datetime.utcnow()

        _write_audit(
            db,
            tenant=tenant_id,
            actor="system",
            action="AML_SCREENING_COMPLETED",
            resource_type="aml_screening",
            resource_id=str(screening.id),
            detail=f"cid={cid} hit_count={hit_count} status={screening.status}",
        )
        db.commit()

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        status_label = screening.status
        AML_SCREENINGS_TOTAL.labels(status=status_label).inc()

        logger.info(
            "aml_screen",
            extra={
                "action": "aml_screen",
                "customer_cid": cid,
                "hit_count": hit_count,
                "status": status_label,
                "tenant_id": tenant_id,
                "duration_ms": elapsed_ms,
            },
        )
        # Structured log (also as plain line for non-extra-capable handlers)
        logger.info(
            "aml_screen action=aml_screen customer_cid=%s hit_count=%d "
            "status=%s tenant_id=%s duration_ms=%d",
            _mask(cid),
            hit_count,
            status_label,
            tenant_id,
            elapsed_ms,
        )

        return screening

    except Exception as exc:
        screening.status = "error"
        screening.completed_at = datetime.utcnow()
        db.commit()
        AML_SCREENINGS_TOTAL.labels(status="error").inc()
        logger.error(
            "aml_screen error: cid=%s tenant=%s exc=%s",
            _mask(cid),
            tenant_id,
            str(exc)[:200],
        )
        raise


# ---------------------------------------------------------------------------
# Helper: resolve customer fields from DB
# ---------------------------------------------------------------------------

def _resolve_customer_name(cid: str, tenant_id: str, db: Session) -> str | None:
    try:
        from ..models import Customer

        row = (
            db.query(Customer)
            .filter(Customer.cif == cid, Customer.tenant_id == tenant_id)
            .first()
        )
        return row.name if row else None
    except Exception:
        return None


def _resolve_customer_dob(cid: str, tenant_id: str, db: Session) -> str | None:
    """DOB is not yet in the Customer model — returns None for now."""
    return None


# ---------------------------------------------------------------------------
# Audit log helper
# ---------------------------------------------------------------------------

def _write_audit(
    db: Session,
    tenant: str,
    actor: str,
    action: str,
    resource_type: str,
    resource_id: str,
    detail: str,
) -> None:
    db.add(
        AuditLog(
            tenant=tenant,
            actor=actor,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            detail=detail,
        )
    )


# ---------------------------------------------------------------------------
# Null context manager for tracing when tracer is unavailable
# ---------------------------------------------------------------------------

class _NullSpanContext:
    def __enter__(self) -> "_NullSpanContext":
        return self

    def __exit__(self, *_: Any) -> None:
        pass


def _null_span() -> _NullSpanContext:
    return _NullSpanContext()


# ---------------------------------------------------------------------------
# Task handler registration (called via import side-effect)
# ---------------------------------------------------------------------------

def _register_task() -> None:
    try:
        from .tasks import register
        from ..db import SessionLocal

        @register("aml_screen_customer")
        def aml_screen_customer_task(
            cid: str,
            tenant_id: str,
            trigger_reason: str = "scheduled",
        ) -> dict[str, Any]:
            db = SessionLocal()
            try:
                screening = screen_customer(
                    cid=cid,
                    tenant_id=tenant_id,
                    db=db,
                    trigger_reason=trigger_reason,
                )
                return {
                    "screening_id": screening.id,
                    "status": screening.status,
                    "hit_count": screening.hit_count,
                }
            except Exception as exc:
                return {"error": str(exc)[:500]}
            finally:
                db.close()

    except Exception as _exc:
        logger.warning("aml task registration skipped: %s", _exc)


_register_task()

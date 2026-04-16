"""Differential-privacy analytics over the document portfolio.

Primitive: Laplace mechanism with ε (epsilon) privacy budget per query class.
Budget is tracked in-process per (tenant, query_class) and refilled daily. When
budget is exhausted, queries return 429 — encouraging teams to batch questions
rather than polling.

Supported query shapes:
  - count(filter)                   → ε consumed: 1.0
  - sum(field, filter)              → ε consumed: 2.0  (sensitivity capped at `clip`)
  - histogram(group_by, filter)     → ε consumed: 2.0

DP is layered on top of the existing RBAC/tenant scope so cross-tenant leakage is
impossible even before noise is added.
"""
from __future__ import annotations
import os
import random
import threading
import time
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Document, OcrResult


# Per-(tenant, query_class) nightly epsilon budget.
DAILY_EPSILON = float(os.environ.get("DP_DAILY_EPSILON", "10.0"))
_budget_lock = threading.Lock()
_budgets: dict[tuple[str, str], tuple[float, float]] = {}  # key → (remaining, reset_ts)


def _day_window() -> float:
    # midnight UTC — reset each day.
    now = datetime.utcnow()
    nxt = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() + 86400
    return nxt


def _consume(tenant: str, cls: str, cost: float) -> tuple[bool, float]:
    with _budget_lock:
        remaining, reset = _budgets.get((tenant, cls), (DAILY_EPSILON, _day_window()))
        if time.time() > reset:
            remaining, reset = DAILY_EPSILON, _day_window()
        if remaining < cost:
            _budgets[(tenant, cls)] = (remaining, reset)
            return False, remaining
        remaining -= cost
        _budgets[(tenant, cls)] = (remaining, reset)
        return True, remaining


def _laplace(scale: float) -> float:
    u = random.random() - 0.5
    return -scale * (1 if u >= 0 else -1) * _log1p_abs(1 - 2 * abs(u))


def _log1p_abs(x: float) -> float:
    import math
    return math.log(max(x, 1e-12))


def _base_query(db: Session, tenant: str):
    return db.query(Document).filter(Document.tenant == tenant)


def dp_count(db: Session, tenant: str, *, doc_type: Optional[str] = None,
             branch: Optional[str] = None, epsilon: float = 1.0) -> dict:
    ok, remaining = _consume(tenant, "count", epsilon)
    if not ok:
        return {"error": "budget_exhausted", "remaining_epsilon": remaining}
    q = _base_query(db, tenant)
    if doc_type:
        q = q.filter(Document.doc_type == doc_type)
    if branch:
        q = q.filter(Document.branch == branch)
    true = int(q.count())
    noisy = round(true + _laplace(1.0 / max(epsilon, 1e-6)))
    return {"query": "count", "epsilon": epsilon, "remaining_epsilon": remaining,
            "result": max(0, noisy)}


def dp_sum_bytes(db: Session, tenant: str, *, clip_mb: float = 10.0,
                 epsilon: float = 2.0) -> dict:
    ok, remaining = _consume(tenant, "sum", epsilon)
    if not ok:
        return {"error": "budget_exhausted", "remaining_epsilon": remaining}
    clip_bytes = int(clip_mb * 1024 * 1024)
    # Clipped sum: bounded sensitivity = clip_bytes.
    q = _base_query(db, tenant).with_entities(
        func.coalesce(func.sum(func.least(Document.size_bytes, clip_bytes)), 0)
    )
    true = int(q.scalar() or 0)
    noisy = int(true + _laplace(clip_bytes / max(epsilon, 1e-6)))
    return {"query": "sum(size_bytes)", "epsilon": epsilon,
            "remaining_epsilon": remaining, "clip_mb": clip_mb,
            "result": max(0, noisy)}


def dp_histogram_status(db: Session, tenant: str, *, epsilon: float = 2.0) -> dict:
    ok, remaining = _consume(tenant, "histogram", epsilon)
    if not ok:
        return {"error": "budget_exhausted", "remaining_epsilon": remaining}
    rows = (
        _base_query(db, tenant)
        .with_entities(Document.status, func.count(Document.id))
        .group_by(Document.status).all()
    )
    # Laplace noise per bucket; bucket counts have sensitivity 1.
    scale = 1.0 / max(epsilon, 1e-6)
    return {"query": "histogram(status)", "epsilon": epsilon,
            "remaining_epsilon": remaining,
            "result": {(s or "(none)"): max(0, int(round((n or 0) + _laplace(scale))))
                       for s, n in rows}}


def budget_status(tenant: str) -> dict:
    with _budget_lock:
        return {cls: round(_budgets.get((tenant, cls), (DAILY_EPSILON, _day_window()))[0], 2)
                for cls in ("count", "sum", "histogram")}

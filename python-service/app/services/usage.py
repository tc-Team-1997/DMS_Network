"""Per-feature usage analytics — middleware + aggregation queries.

A feature id is derived from the route (e.g. POST /api/v1/workflow/{doc_id}/actions →
"workflow.actions"). Rows are batched in-memory and flushed every N seconds so hot
paths don't pay a round-trip to the DB on every request.

Exposed queries:
  - top_features(days)
  - adoption_by_role(feature)
  - cohort(day_bucket, feature)   -> unique users per day bucket
"""
from __future__ import annotations
import os
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from threading import Lock
from typing import Optional

from fastapi import Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware

from ..db import SessionLocal
from ..models import UsageEvent


FLUSH_EVERY_SEC = float(os.environ.get("USAGE_FLUSH_SEC", "3"))
MAX_BUFFER = int(os.environ.get("USAGE_BUFFER", "500"))


_buf: deque = deque()
_buf_lock = Lock()
_last_flush = time.time()


_FEATURE_FROM_PATH = [
    ("workflow.actions", "/api/v1/workflow/", "actions"),
    ("ocr.process", "/api/v1/ocr/", None),
    ("vector.search", "/api/v1/vector/search", None),
    ("copilot.ask", "/api/v1/copilot/ask", None),
    ("coach.view", "/api/v1/coach/", None),
    ("fraud.view", "/api/v1/fraud/", None),
    ("dp.query", "/api/v1/dp/", None),
    ("eform.submit", "/api/v1/eforms/", "submit"),
    ("documents.upload", "/api/v1/documents", "POST"),
    ("oidc.token", "/oidc/token", None),
    ("portal.upload", "/portal/documents", "POST"),
]


def classify(method: str, path: str) -> Optional[str]:
    for label, prefix, flag in _FEATURE_FROM_PATH:
        if prefix in path:
            if flag is None:
                return label
            if flag == "POST" and method == "POST":
                return label
            if flag and flag in path:
                return label
    return None


def _flush(force: bool = False) -> None:
    global _last_flush
    with _buf_lock:
        if not _buf or (not force and len(_buf) < MAX_BUFFER
                        and time.time() - _last_flush < FLUSH_EVERY_SEC):
            return
        batch = list(_buf)
        _buf.clear()
        _last_flush = time.time()
    db = SessionLocal()
    try:
        db.add_all([UsageEvent(**r) for r in batch])
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


class UsageMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        t0 = time.time()
        response = await call_next(request)
        try:
            route = request.scope.get("route")
            path = getattr(route, "path", None) or request.url.path
            feature = classify(request.method, path)
            if feature:
                row = {
                    "feature": feature,
                    "user_sub": request.headers.get("x-user", "anon"),
                    "tenant": request.headers.get("x-tenant", "default"),
                    "branch": request.headers.get("x-branch"),
                    "path": path,
                    "status_code": response.status_code,
                    "latency_ms": int((time.time() - t0) * 1000),
                }
                with _buf_lock:
                    _buf.append(row)
                _flush(force=False)
        except Exception:
            pass
        return response


# ---------- Queries ----------
def top_features(db: Session, days: int = 7, limit: int = 15) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = (db.query(UsageEvent.feature, func.count(UsageEvent.id),
                     func.count(func.distinct(UsageEvent.user_sub)),
                     func.avg(UsageEvent.latency_ms))
            .filter(UsageEvent.created_at >= since)
            .group_by(UsageEvent.feature).all())
    return sorted([{"feature": f, "hits": int(n or 0),
                    "unique_users": int(u or 0),
                    "avg_latency_ms": round(float(a or 0), 1)}
                   for f, n, u, a in rows],
                  key=lambda r: r["hits"], reverse=True)[:limit]


def adoption_by_role(db: Session, feature: str, days: int = 30) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = (db.query(UsageEvent.tenant, UsageEvent.branch, func.count(UsageEvent.id))
            .filter(UsageEvent.feature == feature, UsageEvent.created_at >= since)
            .group_by(UsageEvent.tenant, UsageEvent.branch).all())
    return [{"tenant": t, "branch": b or "(none)", "hits": int(n or 0)}
            for t, b, n in rows]


def daily_cohort(db: Session, feature: str | None = None, days: int = 14) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    q = db.query(func.date(UsageEvent.created_at),
                 func.count(func.distinct(UsageEvent.user_sub))
                 ).filter(UsageEvent.created_at >= since)
    if feature:
        q = q.filter(UsageEvent.feature == feature)
    rows = q.group_by(func.date(UsageEvent.created_at)).all()
    return [{"day": str(d), "unique_users": int(n or 0)} for d, n in rows]

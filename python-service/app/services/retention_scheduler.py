"""Scheduled retention engine.

Runs automatically on startup and then every RETENTION_INTERVAL_SECONDS
(default 3600). A single module-level dict `_last_run` stores the most recent
summary so GET /retention/last-run can serve it without a DB round-trip.

The scheduler uses the *synchronous* SessionLocal (not async) because
retention work is CPU/IO bound and the loop uses asyncio.to_thread to keep
the event loop free.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

RETENTION_INTERVAL = int(os.environ.get("RETENTION_INTERVAL_SECONDS", "3600"))

# Module-level state — survives the life of the process.
_last_run: dict[str, Any] = {
    "status": "never_run",
    "purged": 0,
    "archived": 0,
    "skipped": 0,
    "examined": 0,
    "ran_at": None,
    "error": None,
}


def _run_retention_cycle_sync(db) -> dict[str, Any]:
    """Synchronous core — called via asyncio.to_thread."""
    from datetime import timedelta
    from ..models import Document, RetentionPolicy, LegalHold, AuditLog
    from .events import emit

    now = datetime.utcnow()
    summary: dict[str, Any] = {
        "purged": 0,
        "archived": 0,
        "skipped": 0,
        "examined": 0,
        "ran_at": now.isoformat() + "Z",
        "status": "ok",
        "error": None,
    }

    try:
        # Find all docs that have a matching retention policy.
        rows = (
            db.query(Document, RetentionPolicy)
            .join(RetentionPolicy, RetentionPolicy.doc_type == Document.doc_type)
            .limit(2000)
            .all()
        )

        for doc, pol in rows:
            summary["examined"] += 1
            if not doc.created_at:
                summary["skipped"] += 1
                continue
            if doc.created_at + timedelta(days=pol.retention_days) > now:
                summary["skipped"] += 1
                continue
            # Skip documents already processed.
            if doc.status in ("purged", "archived", "deleted"):
                summary["skipped"] += 1
                continue
            # Respect legal holds.
            active_hold = (
                db.query(LegalHold)
                .filter(
                    LegalHold.document_id == doc.id,
                    LegalHold.released_at == None,  # noqa: E711
                )
                .first()
            )
            if active_hold:
                summary["skipped"] += 1
                continue

            try:
                if pol.action == "archive_cold":
                    doc.status = "archived"
                    db.add(
                        AuditLog(
                            tenant=doc.tenant or "default",
                            actor="retention_scheduler",
                            action="retention_auto_archive",
                            resource_type="document",
                            resource_id=str(doc.id),
                            detail=f"Archived after {pol.retention_days}d retention policy",
                        )
                    )
                    summary["archived"] += 1
                    emit("retention.auto_archive", document_id=doc.id)
                else:
                    # Soft-delete: clear the file path, mark purged.
                    doc.status = "purged"
                    doc.filename = ""
                    db.add(
                        AuditLog(
                            tenant=doc.tenant or "default",
                            actor="retention_scheduler",
                            action="retention_auto_purge",
                            resource_type="document",
                            resource_id=str(doc.id),
                            detail=f"Purged after {pol.retention_days}d retention policy",
                        )
                    )
                    summary["purged"] += 1
                    emit("retention.auto_purge", document_id=doc.id)
            except Exception as row_err:  # noqa: BLE001
                log.warning("retention_scheduler: row %s failed: %s", doc.id, row_err)
                summary["skipped"] += 1

        db.commit()
    except Exception as exc:  # noqa: BLE001
        log.error("retention_scheduler cycle error: %s", exc)
        summary["status"] = "error"
        summary["error"] = str(exc)[:400]
        try:
            db.rollback()
        except Exception:
            pass

    return summary


async def run_retention_cycle(db) -> dict[str, Any]:
    """Async wrapper — runs the sync work in a thread pool."""
    result = await asyncio.to_thread(_run_retention_cycle_sync, db)
    return result


async def _scheduler_loop() -> None:
    """Background task: run on startup, then every RETENTION_INTERVAL seconds."""
    global _last_run
    while True:
        from ..db import SessionLocal
        db = SessionLocal()
        try:
            log.info("retention_scheduler: starting cycle")
            summary = await run_retention_cycle(db)
            _last_run = summary
            log.info(
                "retention_scheduler: done — purged=%d archived=%d skipped=%d",
                summary["purged"],
                summary["archived"],
                summary["skipped"],
            )
        except Exception as exc:  # noqa: BLE001
            log.error("retention_scheduler: unexpected error: %s", exc)
            _last_run = {
                "status": "error",
                "error": str(exc)[:400],
                "purged": 0,
                "archived": 0,
                "skipped": 0,
                "examined": 0,
                "ran_at": datetime.utcnow().isoformat() + "Z",
            }
        finally:
            db.close()
        await asyncio.sleep(RETENTION_INTERVAL)


def get_last_run() -> dict[str, Any]:
    """Return a copy of the last cycle summary (safe to expose in HTTP response)."""
    return dict(_last_run)


def start_scheduler() -> asyncio.Task:
    """Schedule the retention loop as an asyncio background task.

    Must be called from within a running event loop (e.g. FastAPI startup hook).
    """
    return asyncio.create_task(_scheduler_loop(), name="retention_scheduler")

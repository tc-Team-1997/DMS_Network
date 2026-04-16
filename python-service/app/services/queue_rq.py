"""Redis + RQ backend for the task queue.

Activated when REDIS_URL is set; otherwise the in-process queue in tasks.py is used.
Handlers registered via @register in task_handlers.py work unchanged — this module
simply dispatches to RQ instead of asyncio.

Run a worker pod separately:
    rq worker --url $REDIS_URL dms-default
"""
from __future__ import annotations
import os
import json
import uuid
from datetime import datetime
from typing import Any

from .events import emit


REDIS_URL = os.environ.get("REDIS_URL", "").strip()
QUEUE_NAME = os.environ.get("RQ_QUEUE", "dms-default")


def is_enabled() -> bool:
    return bool(REDIS_URL)


def _get_queue():
    from redis import Redis
    from rq import Queue
    return Queue(QUEUE_NAME, connection=Redis.from_url(REDIS_URL))


def _runner(name: str, payload: dict, task_id: str) -> dict:
    """Top-level RQ job — re-imports handlers in worker process."""
    from . import task_handlers  # noqa: F401  (registers handlers)
    from .tasks import _registry
    from ..db import SessionLocal
    from .tasks import TaskRun

    db = SessionLocal()
    try:
        row = db.get(TaskRun, task_id) or TaskRun(id=task_id, name=name)
        row.status = "running"
        row.payload_json = json.dumps(payload)
        if row.id and not db.get(TaskRun, row.id):
            db.add(row)
        db.commit()
        emit("task.started", id=task_id, name=name)

        fn = _registry[name]
        result = fn(**payload)

        row.status = "success"
        row.result_json = json.dumps(result, default=str)[:8000]
        row.finished_at = datetime.utcnow()
        db.commit()
        emit("task.succeeded", id=task_id, name=name, result=result)
        return result
    except Exception as e:
        row.status = "failed"
        row.error = str(e)[:2000]
        row.finished_at = datetime.utcnow()
        db.commit()
        emit("task.failed", id=task_id, name=name, error=str(e))
        raise
    finally:
        db.close()


def enqueue_rq(name: str, payload: dict[str, Any] | None = None) -> str:
    from .tasks import _registry, TaskRun
    from ..db import SessionLocal

    if name not in _registry:
        raise ValueError(f"Unknown task: {name}")
    payload = payload or {}
    task_id = str(uuid.uuid4())

    db = SessionLocal()
    try:
        db.add(TaskRun(id=task_id, name=name, status="queued",
                       payload_json=json.dumps(payload)))
        db.commit()
    finally:
        db.close()

    q = _get_queue()
    q.enqueue(_runner, name, payload, task_id, job_id=task_id, job_timeout=600)
    emit("task.queued", id=task_id, name=name)
    return task_id

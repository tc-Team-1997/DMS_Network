"""Lightweight in-process task queue with worker pool.

For production workloads swap to RQ / Celery by replacing `enqueue()`.
Tasks run on startup workers; results are persisted to the `TaskRun` table
so clients can poll status even after the worker restarts.
"""
from __future__ import annotations
import asyncio
import json
import uuid
from datetime import datetime
from typing import Callable, Any

from sqlalchemy import Column, Integer, String, DateTime, Text
from .events import emit
from ..db import Base, SessionLocal


class TaskRun(Base):
    __tablename__ = "task_runs"
    id = Column(String(36), primary_key=True)
    name = Column(String(64))
    status = Column(String(16), default="queued")  # queued|running|success|failed
    payload_json = Column(Text)
    result_json = Column(Text)
    error = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime)


_queue: asyncio.Queue | None = None
_registry: dict[str, Callable] = {}


def register(name: str):
    def deco(fn: Callable):
        _registry[name] = fn
        return fn
    return deco


def _get_queue() -> asyncio.Queue:
    global _queue
    if _queue is None:
        _queue = asyncio.Queue()
    return _queue


async def enqueue(name: str, payload: dict[str, Any] | None = None) -> str:
    # Route to Redis/RQ when REDIS_URL is configured.
    try:
        from .queue_rq import is_enabled as _rq_on, enqueue_rq
        if _rq_on():
            return enqueue_rq(name, payload)
    except Exception:
        pass

    if name not in _registry:
        raise ValueError(f"Unknown task: {name}")
    task_id = str(uuid.uuid4())
    payload = payload or {}

    db = SessionLocal()
    try:
        db.add(TaskRun(id=task_id, name=name, status="queued",
                       payload_json=json.dumps(payload)))
        db.commit()
    finally:
        db.close()

    await _get_queue().put((task_id, name, payload))
    emit("task.queued", id=task_id, name=name)
    return task_id


async def _run_one(task_id: str, name: str, payload: dict):
    db = SessionLocal()
    row = db.get(TaskRun, task_id)
    row.status = "running"
    db.commit()
    emit("task.started", id=task_id, name=name)
    try:
        fn = _registry[name]
        if asyncio.iscoroutinefunction(fn):
            result = await fn(**payload)
        else:
            result = await asyncio.get_event_loop().run_in_executor(None, lambda: fn(**payload))
        row.status = "success"
        row.result_json = json.dumps(result, default=str)[:8000]
        emit("task.succeeded", id=task_id, name=name, result=result)
    except Exception as e:
        row.status = "failed"
        row.error = str(e)[:2000]
        emit("task.failed", id=task_id, name=name, error=str(e))
    finally:
        row.finished_at = datetime.utcnow()
        db.commit()
        db.close()


async def worker_loop():
    q = _get_queue()
    while True:
        task_id, name, payload = await q.get()
        try:
            await _run_one(task_id, name, payload)
        finally:
            q.task_done()


async def start_workers(n: int = 2):
    for _ in range(n):
        asyncio.create_task(worker_loop())

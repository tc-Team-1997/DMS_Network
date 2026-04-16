from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.tasks import TaskRun, enqueue

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"], dependencies=[Depends(require_api_key)])


class EnqueueIn(BaseModel):
    name: str
    payload: dict = {}


@router.post("")
async def enqueue_task(body: EnqueueIn):
    try:
        task_id = await enqueue(body.name, body.payload)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": task_id, "status": "queued"}


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    row = db.get(TaskRun, task_id)
    if not row:
        raise HTTPException(404, "Task not found")
    import json as _json
    return {
        "id": row.id, "name": row.name, "status": row.status,
        "payload": _json.loads(row.payload_json or "{}"),
        "result": _json.loads(row.result_json) if row.result_json else None,
        "error": row.error,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
    }


@router.get("")
def list_tasks(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.query(TaskRun).order_by(TaskRun.created_at.desc()).limit(limit).all()
    return [{"id": r.id, "name": r.name, "status": r.status,
             "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]

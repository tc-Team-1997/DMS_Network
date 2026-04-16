from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import IntegrationLog
from ..schemas import IntegrationCallIn
from ..security import require_api_key
from ..services.integrations import call_system

router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"], dependencies=[Depends(require_api_key)])


@router.post("/call")
async def call(payload: IntegrationCallIn, db: Session = Depends(get_db)):
    try:
        return await call_system(db, payload.system, payload.endpoint, payload.method, payload.payload)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/logs")
def logs(system: str | None = Query(None), limit: int = 50, db: Session = Depends(get_db)):
    q = db.query(IntegrationLog)
    if system:
        q = q.filter(IntegrationLog.system == system)
    rows = q.order_by(IntegrationLog.id.desc()).limit(limit).all()
    return [
        {
            "id": r.id, "system": r.system, "endpoint": r.endpoint,
            "method": r.method, "status_code": r.status_code,
            "latency_ms": r.latency_ms, "created_at": r.created_at.isoformat(),
        } for r in rows
    ]


@router.get("/status")
def status():
    return {
        "cbs": {"status": "online", "latency_ms": 38},
        "los": {"status": "online", "latency_ms": 52},
        "aml": {"status": "degraded", "latency_ms": 412},
        "ifrs9": {"status": "online", "latency_ms": 61},
    }

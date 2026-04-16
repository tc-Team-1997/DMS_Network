from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import RetentionPolicy, LegalHold
from ..services.auth import require, Principal
from ..services.retention import (
    upsert_policy, apply_due, purge_due,
    place_hold, release_hold,
)

router = APIRouter(prefix="/api/v1/retention", tags=["retention"])


class PolicyIn(BaseModel):
    doc_type: str
    retention_days: int
    action: str = "purge"


class HoldIn(BaseModel):
    document_id: int
    reason: str
    case_ref: str


@router.post("/policies")
def upsert(body: PolicyIn, db: Session = Depends(get_db),
           p: Principal = Depends(require("admin"))):
    pol = upsert_policy(db, body.doc_type, body.retention_days, body.action, p.tenant)
    return {"id": pol.id, "doc_type": pol.doc_type,
            "retention_days": pol.retention_days, "action": pol.action}


@router.get("/policies")
def list_policies(db: Session = Depends(get_db),
                  p: Principal = Depends(require("admin"))):
    rows = db.query(RetentionPolicy).filter(RetentionPolicy.tenant == p.tenant).all()
    return [{"id": r.id, "doc_type": r.doc_type,
             "retention_days": r.retention_days, "action": r.action} for r in rows]


@router.get("/due")
def due(db: Session = Depends(get_db), p: Principal = Depends(require("admin"))):
    rows = purge_due(db, tenant=p.tenant)
    return [{"id": r["document"].id, "doc_type": r["document"].doc_type,
             "action": r["policy"].action,
             "created_at": r["document"].created_at.isoformat() if r["document"].created_at else None}
            for r in rows]


@router.post("/apply")
def apply(dry_run: bool = Query(True), db: Session = Depends(get_db),
          p: Principal = Depends(require("admin"))):
    return apply_due(db, dry_run=dry_run, tenant=p.tenant)


@router.post("/holds")
def add_hold(body: HoldIn, db: Session = Depends(get_db),
             p: Principal = Depends(require("admin"))):
    h = place_hold(db, body.document_id, body.reason, body.case_ref, p.sub)
    return {"id": h.id, "document_id": h.document_id, "case_ref": h.case_ref}


@router.delete("/holds/{hold_id}")
def release(hold_id: int, db: Session = Depends(get_db),
            p: Principal = Depends(require("admin"))):
    try:
        h = release_hold(db, hold_id, p.sub)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"id": h.id, "released_by": h.released_by,
            "released_at": h.released_at.isoformat() if h.released_at else None}


@router.get("/holds")
def list_holds(active_only: bool = True, db: Session = Depends(get_db),
               p: Principal = Depends(require("admin"))):
    q = db.query(LegalHold)
    if active_only:
        q = q.filter(LegalHold.released_at == None)  # noqa: E711
    return [{"id": h.id, "document_id": h.document_id, "reason": h.reason,
             "case_ref": h.case_ref, "placed_by": h.placed_by,
             "placed_at": h.placed_at.isoformat() if h.placed_at else None,
             "released_at": h.released_at.isoformat() if h.released_at else None}
            for h in q.all()]

"""Inbound replication endpoint from sibling regions.

Peers call POST /api/v1/replication/apply with a snapshot of a document mutation.
Local row is merged via CRDT lamport/LWW rules; append-only children (workflow steps,
duplicate matches) are upserted by id.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document, WorkflowStep
from ..services.auth import current_principal, Principal
from ..services import crdt


router = APIRouter(prefix="/api/v1/replication", tags=["replication"])


SCALAR_FIELDS = ["doc_type", "customer_cid", "branch", "status",
                 "issue_date", "expiry_date", "uploaded_by", "tenant"]


class ReplicatedDoc(BaseModel):
    id: int
    sync_clock: str | None = None
    original_name: str | None = None
    doc_type: str | None = None
    customer_cid: str | None = None
    branch: str | None = None
    tenant: str | None = None
    status: str | None = None
    issue_date: str | None = None
    expiry_date: str | None = None
    uploaded_by: str | None = None
    workflow_steps: list[dict] = []


@router.post("/apply")
def apply(body: ReplicatedDoc, db: Session = Depends(get_db),
          p: Principal = Depends(current_principal)):
    if "doc_admin" not in p.roles:
        raise HTTPException(403, "Only doc_admin can receive replication events")

    local = db.get(Document, body.id)
    remote = body.model_dump()

    if local is None:
        # Net-new doc from peer — create with its clock.
        doc = Document(
            id=body.id,
            filename=f"__replicated_{body.id}__",
            original_name=body.original_name or f"replicated-{body.id}",
            sync_clock=body.sync_clock,
            **{k: getattr(body, k) for k in SCALAR_FIELDS if getattr(body, k) is not None},
        )
        db.add(doc)
    else:
        local_snapshot = {k: getattr(local, k) for k in SCALAR_FIELDS}
        local_snapshot["sync_clock"] = local.sync_clock
        merged = crdt.merge(local_snapshot, remote)
        for k in SCALAR_FIELDS:
            if k in merged and merged[k] is not None:
                setattr(local, k, merged[k])
        local.sync_clock = merged["sync_clock"]

    # Append-only: workflow steps unioned by id.
    for step in body.workflow_steps:
        sid = step.get("id")
        if sid and db.get(WorkflowStep, sid):
            continue
        db.add(WorkflowStep(
            id=sid,
            document_id=body.id,
            stage=step.get("stage"), actor=step.get("actor"),
            action=step.get("action"), comment=step.get("comment"),
        ))

    db.commit()
    return {"id": body.id, "sync_clock": (local.sync_clock if local else body.sync_clock)}

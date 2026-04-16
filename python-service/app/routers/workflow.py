from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document, WorkflowStep
from ..schemas import WorkflowActionIn, WorkflowStepOut
from ..security import require_api_key
from ..services.events import emit
from ..services.auth import current_principal, Principal
from ..services.webauthn_svc import has_valid_stepup
from ..services.fraud import score as fraud_score
from ..services.provenance import record as prov_record

router = APIRouter(prefix="/api/v1/workflow", tags=["workflow"], dependencies=[Depends(require_api_key)])

STAGE_ORDER = ["capture", "ai_index", "maker", "checker", "approve", "archive"]


def _next_status(current: str, action: str, stage: str) -> str:
    if action == "reject":
        return "rejected"
    if action == "approve" and stage == "approve":
        return "archived"
    if action == "approve":
        try:
            idx = STAGE_ORDER.index(stage)
            return STAGE_ORDER[min(idx + 1, len(STAGE_ORDER) - 1)]
        except ValueError:
            return current
    return current


@router.post("/{doc_id}/actions", response_model=WorkflowStepOut)
def workflow_action(doc_id: int, payload: WorkflowActionIn,
                    db: Session = Depends(get_db),
                    p: Principal = Depends(current_principal)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    # Step-up gate: approving a high/critical-risk doc requires a recent WebAuthn assertion.
    if payload.action == "approve":
        risk = fraud_score(db, doc)
        if risk["band"] in ("high", "critical") and not has_valid_stepup(
            db, p.sub, "approve_document", doc.id
        ):
            raise HTTPException(403, {
                "error": "stepup_required",
                "risk_band": risk["band"],
                "score": risk["score"],
                "message": "High-risk approval requires WebAuthn step-up",
            })

    step = WorkflowStep(
        document_id=doc.id,
        stage=payload.stage,
        actor=payload.actor,
        action=payload.action,
        comment=payload.comment,
    )
    db.add(step)
    doc.status = _next_status(doc.status, payload.action, payload.stage)
    db.commit()
    db.refresh(step)
    emit("workflow.action", document_id=doc.id, stage=payload.stage,
         action=payload.action, actor=payload.actor, new_status=doc.status)
    prov_record(db, doc.id, f"workflow.{payload.action}", actor=payload.actor,
                payload={"stage": payload.stage, "new_status": doc.status})
    return step


@router.get("/{doc_id}/history", response_model=List[WorkflowStepOut])
def history(doc_id: int, db: Session = Depends(get_db)):
    return (
        db.query(WorkflowStep)
        .filter(WorkflowStep.document_id == doc_id)
        .order_by(WorkflowStep.id.asc())
        .all()
    )


@router.get("/pending", response_model=List[WorkflowStepOut])
def pending(stage: str = "maker", db: Session = Depends(get_db)):
    # Single-query: last workflow step per doc whose status == stage.
    from sqlalchemy import func
    sub = (
        db.query(WorkflowStep.document_id, func.max(WorkflowStep.id).label("last_id"))
        .join(Document, Document.id == WorkflowStep.document_id)
        .filter(Document.status == stage)
        .group_by(WorkflowStep.document_id)
        .subquery()
    )
    return (
        db.query(WorkflowStep)
        .join(sub, WorkflowStep.id == sub.c.last_id)
        .all()
    )

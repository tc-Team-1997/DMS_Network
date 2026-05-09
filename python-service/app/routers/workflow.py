from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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


class AdvancePayload(BaseModel):
    """Full context for the SOX-2 two-phase audit-unification advance call.

    Node calls this endpoint FIRST; on success (Python commits workflow_steps)
    Node then commits wf_actions with the returned step_id as python_step_id.
    If Python fails, Node never commits its row.
    """
    stage: str
    action: str                       # approve | reject | escalate
    actor: str
    comment: Optional[str] = None
    reason_code: Optional[str] = None
    assertion_id: Optional[str] = None


class AdvanceOut(BaseModel):
    step_id: int
    document_id: int
    stage: str
    actor: str
    action: str
    comment: Optional[str]
    reason_code: Optional[str]
    assertion_id: Optional[str]
    new_status: str
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/{doc_id}/advance", response_model=AdvanceOut)
def advance(doc_id: int, payload: AdvancePayload,
            db: Session = Depends(get_db),
            p: Principal = Depends(current_principal)):
    """Two-phase audit-unification entry point (SOX-2 Wave C).

    Writes workflow_steps and updates doc.status atomically.
    Returns step_id so Node can write wf_actions.python_step_id.

    If the step-up gate is required (high/critical risk + approve action)
    the existing has_valid_stepup check is applied.  assertion_id in the
    payload is stored for cross-reference but cryptographic validation
    has already occurred on the Node side via POST /api/v1/stepup/verify.
    """
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

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
        reason_code=payload.reason_code,
        assertion_id=payload.assertion_id,
    )
    db.add(step)
    doc.status = _next_status(doc.status, payload.action, payload.stage)
    db.commit()
    db.refresh(step)

    emit("workflow.advance", document_id=doc.id, stage=payload.stage,
         action=payload.action, actor=payload.actor, new_status=doc.status)
    prov_record(db, doc.id, f"workflow.{payload.action}", actor=payload.actor,
                payload={"stage": payload.stage, "new_status": doc.status,
                         "reason_code": payload.reason_code})

    return AdvanceOut(
        step_id=step.id,
        document_id=step.document_id,
        stage=step.stage,
        actor=step.actor,
        action=step.action,
        comment=step.comment,
        reason_code=step.reason_code,
        assertion_id=step.assertion_id,
        new_status=doc.status,
        created_at=step.created_at,
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

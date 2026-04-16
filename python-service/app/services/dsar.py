"""GDPR Data-Subject-Access-Request handlers.

  export(cid)  — collect everything tied to a customer CID into a single ZIP:
                 metadata JSON + OCR JSON + workflow trail + e-form submissions
                 + the original files + portal sessions (PII-redacted).
  erase(cid)   — right-to-erasure: soft-delete documents by setting status='erased'
                 and nulling PII fields; skips documents with active legal holds.

Soft-delete (rather than hard delete) keeps the audit chain intact as required by
most banking regulators (CBE keeps operational audit trails for 7 years). Hard delete
is handled by the retention engine once the audit-retention window expires.
"""
from __future__ import annotations
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from ..models import Document, OcrResult, WorkflowStep, EFormSubmission, PortalSession, LegalHold
from .redaction import redact_event


def _serialize_doc(doc: Document) -> dict:
    return {
        "id": doc.id, "original_name": doc.original_name, "mime_type": doc.mime_type,
        "size_bytes": doc.size_bytes, "sha256": doc.sha256,
        "doc_type": doc.doc_type, "customer_cid": doc.customer_cid,
        "branch": doc.branch, "tenant": doc.tenant, "status": doc.status,
        "issue_date": doc.issue_date, "expiry_date": doc.expiry_date,
        "uploaded_by": doc.uploaded_by,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


def export(db: Session, customer_cid: str) -> bytes:
    docs = db.query(Document).filter(Document.customer_cid == customer_cid).all()
    doc_ids = [d.id for d in docs]

    ocr_rows = db.query(OcrResult).filter(OcrResult.document_id.in_(doc_ids)).all() if doc_ids else []
    wf_rows = db.query(WorkflowStep).filter(WorkflowStep.document_id.in_(doc_ids)).all() if doc_ids else []
    form_rows = db.query(EFormSubmission).filter(EFormSubmission.customer_cid == customer_cid).all()
    sessions = db.query(PortalSession).filter(PortalSession.customer_cid == customer_cid).all()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "customer_cid": customer_cid,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "counts": {
                "documents": len(docs), "ocr_records": len(ocr_rows),
                "workflow_steps": len(wf_rows), "form_submissions": len(form_rows),
                "portal_sessions": len(sessions),
            },
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        zf.writestr("documents.json", json.dumps([_serialize_doc(d) for d in docs], indent=2))
        zf.writestr("ocr.json", json.dumps([
            {"document_id": o.document_id, "confidence": o.confidence,
             "text": o.text, "fields": json.loads(o.fields_json or "{}")}
            for o in ocr_rows
        ], indent=2))
        zf.writestr("workflow.json", json.dumps([
            {"id": w.id, "document_id": w.document_id, "stage": w.stage,
             "actor": w.actor, "action": w.action, "comment": w.comment,
             "created_at": w.created_at.isoformat() if w.created_at else None}
            for w in wf_rows
        ], indent=2))
        zf.writestr("eform_submissions.json", json.dumps([
            {"id": s.id, "form_id": s.form_id, "document_id": s.document_id,
             "data": json.loads(s.data_json or "{}"), "status": s.status,
             "created_at": s.created_at.isoformat() if s.created_at else None}
            for s in form_rows
        ], indent=2))
        zf.writestr("portal_sessions.json", json.dumps([
            redact_event({
                "email": s.email, "verified_at": s.verified_at.isoformat() if s.verified_at else None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }) for s in sessions
        ], indent=2))

        # Original files
        for d in docs:
            p = Path(d.filename)
            if p.exists():
                try:
                    zf.write(p, arcname=f"files/{d.id}_{d.original_name}")
                except Exception:
                    pass

    return buf.getvalue()


def erase(db: Session, customer_cid: str, actor: str) -> dict:
    """Soft-erase: skip docs under legal hold, null PII fields on the rest."""
    docs = db.query(Document).filter(Document.customer_cid == customer_cid).all()
    held = {
        h.document_id for h in db.query(LegalHold).filter(
            LegalHold.document_id.in_([d.id for d in docs]),
            LegalHold.released_at == None,  # noqa: E711
        ).all()
    }
    erased: list[int] = []
    skipped: list[int] = []
    for d in docs:
        if d.id in held:
            skipped.append(d.id)
            continue
        d.customer_cid = None
        d.uploaded_by = "erased"
        d.status = "erased"
        erased.append(d.id)
        db.add(WorkflowStep(document_id=d.id, stage="gdpr", actor=actor,
                            action="erased", comment="right-to-erasure"))
    db.commit()
    return {
        "customer_cid": customer_cid,
        "erased_document_ids": erased,
        "skipped_legal_hold": skipped,
    }

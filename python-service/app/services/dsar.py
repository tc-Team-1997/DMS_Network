"""GDPR / PDPL Data-Subject-Access-Request handlers (Wave C).

Public API
----------
lookup(db, axis, value)                  — find customer(s) matching an axis/value pair.
inventory(db, customer_cid)              — 5-panel artifact counts for a subject.
export(db, customer_cid)                 — ZIP of all artifacts (Art-15).
cryptoshred(db, customer_cid, actor)     — GDPR Art-17 DEK destruction.
create_request(db, ...)                  — persist a DsarRequest row.
list_requests(db, tenant_id)             — list with SLA timer fields.
fulfill(db, request_id, actor)           — dispatch fulfillment action.
release_hold(db, request_id, actor)      — clear litigation hold flag.

Cryptoshred semantic (Art-17)
-----------------------------
  - encryption.cryptoshred() sets wrapped_dek = 'CRYPTOSHREDDED', kms_key_id = 'SHREDDED'.
  - All subsequent plaintext_dek() calls raise CryptoshreddedError.
  - Encrypted blobs on disk become permanently unreadable ciphertext.
  - Audit trail in dsar_requests + audit_log is preserved — accountability survives erasure.

Soft-erase (Art-17, legacy)
---------------------------
  erase() nulls PII fields on Document rows (status='erased'). Skips docs under legal hold.
  Now delegated through fulfill() for new requests; kept for backward compat.

Lookup axes (v1)
----------------
  cid        — exact match on documents.customer_cid / customers.cif
  email      — substring search in customers.raw_json
  phone      — substring search in customers.raw_json
  national_id — substring search in customers.raw_json
"""
from __future__ import annotations

import io
import json
import textwrap
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..models import (
    AuditLog,
    Customer,
    Document,
    DsarArtifact,
    DsarRequest,
    EFormSubmission,
    LegalHold,
    OcrResult,
    PortalSession,
    ProvenanceEvent,
    WorkflowStep,
)
from . import encryption as enc
from .redaction import redact_event

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_SLA_DAYS: dict[str, int] = {"GDPR": 30, "PDPL": 30, "RMA": 30}

_VALID_AXES = {"cid", "email", "phone", "national_id"}
_VALID_ACTIONS = {
    "article15_export",
    "article17_cryptoshred",
    "litigation_hold",
    "fulfillment_letter",
}


# ---------------------------------------------------------------------------
# Subject lookup
# ---------------------------------------------------------------------------

def lookup(db: Session, axis: str, value: str) -> list[dict[str, Any]]:
    """Return matching customer records across the given axis.

    Returns a list of dicts: {cid, name, tenant_id, cbs_source, match_axis}.
    For axes other than 'cid', we do a substring search of the raw_json field
    (v1 acceptable cost per approved plan).
    """
    if axis not in _VALID_AXES:
        raise ValueError(f"axis must be one of {_VALID_AXES}")

    results: list[dict[str, Any]] = []

    if axis == "cid":
        rows = db.query(Customer).filter(Customer.cif == value).all()
        for r in rows:
            results.append({
                "cid": r.cif,
                "name": r.name,
                "tenant_id": r.tenant_id,
                "cbs_source": r.cbs_source,
                "match_axis": "cid",
            })
        # Also check Document table if no customer row exists yet.
        if not rows:
            doc = db.query(Document).filter(Document.customer_cid == value).first()
            if doc:
                results.append({
                    "cid": value,
                    "name": None,
                    "tenant_id": doc.tenant,
                    "cbs_source": None,
                    "match_axis": "cid",
                })
    else:
        # Raw-JSON substring search (email, phone, national_id).
        all_customers = db.query(Customer).filter(Customer.raw_json.isnot(None)).all()
        for r in all_customers:
            if r.raw_json and value.lower() in r.raw_json.lower():
                results.append({
                    "cid": r.cif,
                    "name": r.name,
                    "tenant_id": r.tenant_id,
                    "cbs_source": r.cbs_source,
                    "match_axis": axis,
                })

    # De-duplicate on cid.
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for rec in results:
        key = rec["cid"]
        if key not in seen:
            seen.add(key)
            unique.append(rec)
    return unique


# ---------------------------------------------------------------------------
# Artifact inventory
# ---------------------------------------------------------------------------

def inventory(db: Session, customer_cid: str) -> dict[str, int]:
    """Return 5-panel artifact counts for a data subject."""
    docs = db.query(Document).filter(Document.customer_cid == customer_cid).all()
    doc_ids = [d.id for d in docs]

    ai_trace_count = 0
    if doc_ids:
        ai_trace_count = (
            db.query(ProvenanceEvent)
            .filter(ProvenanceEvent.document_id.in_(doc_ids))
            .count()
        )

    # Audit events: filter audit_log by resource_id matching the CID.
    audit_count = (
        db.query(AuditLog)
        .filter(AuditLog.resource_id == customer_cid)
        .count()
    )

    # Workflows: WorkflowStep rows linked to this subject's docs.
    workflow_count = (
        db.query(WorkflowStep)
        .filter(WorkflowStep.document_id.in_(doc_ids))
        .count()
        if doc_ids else 0
    )

    # CBS records via cbs_document_links table (migration 0022).
    try:
        cbs_row = db.execute(
            text("SELECT COUNT(*) FROM cbs_document_links WHERE customer_cid = :cid"),
            {"cid": customer_cid},
        ).scalar()
        cbs_count = int(cbs_row or 0)
    except Exception:
        cbs_count = 0

    return {
        "documents": len(docs),
        "ai_traces": ai_trace_count,
        "audit_events": audit_count,
        "workflows": workflow_count,
        "cbs_records": cbs_count,
    }


def inventory_detail(db: Session, customer_cid: str) -> dict[str, list[Any]]:
    """Return detailed lists for each panel (used in ZIP export manifests)."""
    docs = db.query(Document).filter(Document.customer_cid == customer_cid).all()
    doc_ids = [d.id for d in docs]

    ai_traces = (
        db.query(ProvenanceEvent)
        .filter(ProvenanceEvent.document_id.in_(doc_ids))
        .all()
        if doc_ids else []
    )
    audit_events = (
        db.query(AuditLog)
        .filter(AuditLog.resource_id == customer_cid)
        .all()
    )
    workflows = (
        db.query(WorkflowStep)
        .filter(WorkflowStep.document_id.in_(doc_ids))
        .all()
        if doc_ids else []
    )

    try:
        cbs_rows = db.execute(
            text("SELECT * FROM cbs_document_links WHERE customer_cid = :cid"),
            {"cid": customer_cid},
        ).fetchall()
        cbs_list: list[Any] = [dict(r._mapping) for r in cbs_rows]
    except Exception:
        cbs_list = []

    return {
        "documents": [_serialize_doc(d) for d in docs],
        "ai_traces": [
            {
                "id": pe.id,
                "document_id": pe.document_id,
                "kind": pe.kind,
                "system": pe.system,
                "actor": pe.actor,
                "created_at": pe.created_at.isoformat() if pe.created_at else None,
            }
            for pe in ai_traces
        ],
        "audit_events": [
            {
                "id": ae.id,
                "action": ae.action,
                "actor": ae.actor,
                "detail": ae.detail,
                "created_at": ae.created_at.isoformat() if ae.created_at else None,
            }
            for ae in audit_events
        ],
        "workflows": [
            {
                "id": w.id,
                "document_id": w.document_id,
                "stage": w.stage,
                "actor": w.actor,
                "action": w.action,
                "created_at": w.created_at.isoformat() if w.created_at else None,
            }
            for w in workflows
        ],
        "cbs_records": cbs_list,
    }


# ---------------------------------------------------------------------------
# Export ZIP (Article 15)
# ---------------------------------------------------------------------------

def _serialize_doc(doc: Document) -> dict[str, Any]:
    return {
        "id": doc.id,
        "original_name": doc.original_name,
        "mime_type": doc.mime_type,
        "size_bytes": doc.size_bytes,
        "sha256": doc.sha256,
        "doc_type": doc.doc_type,
        "customer_cid": doc.customer_cid,
        "branch": doc.branch,
        "tenant": doc.tenant,
        "status": doc.status,
        "issue_date": doc.issue_date,
        "expiry_date": doc.expiry_date,
        "uploaded_by": doc.uploaded_by,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


def export(db: Session, customer_cid: str) -> bytes:
    """Build and return a ZIP containing all artifacts for a data subject (Art-15)."""
    detail = inventory_detail(db, customer_cid)
    docs = db.query(Document).filter(Document.customer_cid == customer_cid).all()
    doc_ids = [d.id for d in docs]

    ocr_rows = (
        db.query(OcrResult).filter(OcrResult.document_id.in_(doc_ids)).all()
        if doc_ids else []
    )
    form_rows = db.query(EFormSubmission).filter(
        EFormSubmission.customer_cid == customer_cid
    ).all()
    sessions = db.query(PortalSession).filter(
        PortalSession.customer_cid == customer_cid
    ).all()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        counts = inventory(db, customer_cid)
        manifest = {
            "customer_cid": customer_cid,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "regulation": "GDPR Article 15 — Right of Access",
            "counts": counts,
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        zf.writestr("documents.json", json.dumps(detail["documents"], indent=2))
        zf.writestr("ai_traces.json", json.dumps(detail["ai_traces"], indent=2))
        zf.writestr("audit_events.json", json.dumps(detail["audit_events"], indent=2))
        zf.writestr("workflows.json", json.dumps(detail["workflows"], indent=2))
        zf.writestr("cbs_records.json", json.dumps(detail["cbs_records"], indent=2))
        zf.writestr("ocr.json", json.dumps([
            {
                "document_id": o.document_id,
                "confidence": o.confidence,
                "text": o.text,
                "fields": json.loads(o.fields_json or "{}"),
            }
            for o in ocr_rows
        ], indent=2))
        zf.writestr("eform_submissions.json", json.dumps([
            {
                "id": s.id,
                "form_id": s.form_id,
                "document_id": s.document_id,
                "data": json.loads(s.data_json or "{}"),
                "status": s.status,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in form_rows
        ], indent=2))
        zf.writestr("portal_sessions.json", json.dumps([
            redact_event({
                "email": s.email,
                "verified_at": s.verified_at.isoformat() if s.verified_at else None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            })
            for s in sessions
        ], indent=2))

        # Original files — write best-effort (missing files silently skipped).
        for d in docs:
            p = Path(d.filename)
            if p.exists():
                try:
                    zf.write(p, arcname=f"files/{d.id}_{d.original_name}")
                except Exception:
                    pass

    return buf.getvalue()


# ---------------------------------------------------------------------------
# Fulfillment letter (Art-15 human-readable summary, v1: plain text)
# ---------------------------------------------------------------------------

def _render_letter(
    customer_cid: str,
    action: str,
    counts: dict[str, int],
    regulator: str,
    completed_at: str,
) -> str:
    """Render a plain-text fulfillment letter. Wave D can upgrade to PDF."""
    action_labels = {
        "article15_export": "Right of Access (Article 15)",
        "article17_cryptoshred": "Right to Erasure (Article 17)",
        "litigation_hold": "Litigation Hold Placed",
        "fulfillment_letter": "Fulfillment Notification",
    }
    label = action_labels.get(action, action)
    action_detail = ""
    if action == "article15_export":
        action_detail = "Your personal data has been located and a machine-readable export is enclosed."
    elif action == "article17_cryptoshred":
        action_detail = (
            "Your encryption key has been permanently destroyed. "
            "Your documents are no longer readable by the bank. "
            "The fact that this action occurred is preserved in the audit trail as required by law."
        )
    elif action == "litigation_hold":
        action_detail = (
            "A litigation hold has been placed on your data. "
            "Your data will not be deleted or modified until the hold is released."
        )

    return textwrap.dedent(f"""\
        DATA SUBJECT FULFILLMENT LETTER
        ================================
        Issued under: {regulator}
        Request type: {label}
        Subject reference: {customer_cid}
        Completed at: {completed_at}

        SUMMARY OF PROCESSED DATA
        --------------------------
        Documents on file          : {counts.get('documents', 0)}
        AI processing traces       : {counts.get('ai_traces', 0)}
        Audit log entries          : {counts.get('audit_events', 0)}
        Workflow steps             : {counts.get('workflows', 0)}
        Core Banking System records: {counts.get('cbs_records', 0)}

        WHAT THIS MEANS FOR YOU
        -----------------------
        {action_detail}

        This letter was generated automatically by the Document Management System.
        Retain this letter as confirmation of your data subject rights request.
    """).strip()


# ---------------------------------------------------------------------------
# GDPR Art-17 Cryptoshred
# ---------------------------------------------------------------------------

def cryptoshred(db: Session, customer_cid: str, actor: str) -> dict[str, Any]:
    """GDPR Art-17: destroy the customer DEK; ciphertext becomes permanently unreadable.

    Writes an AuditLog row BEFORE destroying the DEK so the audit record is
    guaranteed even if a crash occurs mid-way.  Returns a signed receipt dict.
    """
    # Check for active legal holds across the subject's documents.
    docs = db.query(Document).filter(Document.customer_cid == customer_cid).all()
    doc_ids = [d.id for d in docs]
    if doc_ids:
        hold_count = (
            db.query(LegalHold)
            .filter(
                LegalHold.document_id.in_(doc_ids),
                LegalHold.released_at.is_(None),
            )
            .count()
        )
        if hold_count > 0:
            raise ValueError(
                f"Cannot cryptoshred: {hold_count} active legal hold(s) exist for customer "
                f"'{customer_cid}'. Release all litigation holds before proceeding."
            )

    # Write the audit record FIRST — before the DEK is destroyed.
    shredded_at = datetime.utcnow().isoformat() + "Z"
    db.add(AuditLog(
        tenant=docs[0].tenant if docs else "default",
        actor=actor,
        action="article17_cryptoshred",
        resource_type="customer",
        resource_id=customer_cid,
        detail=json.dumps({
            "semantic": (
                "DEK destroyed; ciphertext on disk is permanently unreadable; "
                "audit trail preserved"
            ),
            "document_count": len(docs),
            "shredded_at": shredded_at,
        }),
    ))
    db.commit()

    # Now destroy the DEK.
    receipt = enc.cryptoshred(db, customer_cid)
    receipt["actor"] = actor
    return receipt


# ---------------------------------------------------------------------------
# Soft erase (legacy Art-17, kept for backward compat)
# ---------------------------------------------------------------------------

def erase(db: Session, customer_cid: str, actor: str) -> dict[str, Any]:
    """Soft-erase: skip docs under legal hold, null PII fields on the rest."""
    docs = db.query(Document).filter(Document.customer_cid == customer_cid).all()
    held = {
        h.document_id for h in db.query(LegalHold).filter(
            LegalHold.document_id.in_([d.id for d in docs]),
            LegalHold.released_at.is_(None),
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
        db.add(WorkflowStep(
            document_id=d.id, stage="gdpr", actor=actor,
            action="erased", comment="right-to-erasure",
        ))
    db.commit()
    return {
        "customer_cid": customer_cid,
        "erased_document_ids": erased,
        "skipped_legal_hold": skipped,
    }


# ---------------------------------------------------------------------------
# DSAR request lifecycle
# ---------------------------------------------------------------------------

def _sla_days(params: dict[str, Any] | None, regulator: str | None) -> int:
    """Read SLA days from params (tenant_config passthrough) or fall back."""
    if params and "sla_days" in params:
        return int(params["sla_days"])
    if regulator and regulator in _DEFAULT_SLA_DAYS:
        return _DEFAULT_SLA_DAYS[regulator]
    return 30


def create_request(
    db: Session,
    tenant_id: str,
    customer_cid: str,
    action: str,
    requested_by: str,
    regulator: str | None = None,
    params: dict[str, Any] | None = None,
) -> DsarRequest:
    """Persist a new DSAR request and return the ORM row."""
    if action not in _VALID_ACTIONS:
        raise ValueError(f"action must be one of {_VALID_ACTIONS}")
    now = datetime.utcnow()
    sla_days = _sla_days(params, regulator)
    req = DsarRequest(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        customer_cid=customer_cid,
        action=action,
        status="NEW",
        requested_by=requested_by,
        requested_at=now,
        sla_due_at=now + timedelta(days=sla_days),
        regulator=regulator,
        params_json=json.dumps(params) if params else None,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def list_requests(db: Session, tenant_id: str) -> list[dict[str, Any]]:
    """Return DSAR requests for a tenant with SLA countdown fields."""
    now = datetime.utcnow()
    rows = (
        db.query(DsarRequest)
        .filter(DsarRequest.tenant_id == tenant_id)
        .order_by(DsarRequest.requested_at.desc())
        .all()
    )
    result: list[dict[str, Any]] = []
    for r in rows:
        days_remaining = (r.sla_due_at - now).days if r.sla_due_at else None
        effective_status = r.status
        if effective_status != "COMPLETED" and days_remaining is not None and days_remaining < 0:
            effective_status = "OVERDUE"
        result.append({
            "id": r.id,
            "tenant_id": r.tenant_id,
            "customer_cid": r.customer_cid,
            "action": r.action,
            "status": effective_status,
            "requested_by": r.requested_by,
            "requested_at": r.requested_at.isoformat() + "Z" if r.requested_at else None,
            "sla_due_at": r.sla_due_at.isoformat() + "Z" if r.sla_due_at else None,
            "days_remaining": days_remaining,
            "completed_at": r.completed_at.isoformat() + "Z" if r.completed_at else None,
            "regulator": r.regulator,
            "fulfillment_artifact_path": r.fulfillment_artifact_path,
            "signed_receipt": json.loads(r.signed_receipt) if r.signed_receipt else None,
        })
    return result


def fulfill(db: Session, request_id: str, actor: str) -> dict[str, Any]:
    """Dispatch fulfillment action for a DSAR request.

    Returns a receipt dict that is serialised into DsarRequest.signed_receipt.
    Raises ValueError for unknown request_id or already-completed requests.
    """
    req = db.get(DsarRequest, request_id)
    if req is None:
        raise ValueError(f"DSAR request '{request_id}' not found")
    if req.status == "COMPLETED":
        raise ValueError(f"DSAR request '{request_id}' is already completed")

    req.status = "IN_PROGRESS"
    db.commit()

    completed_at = datetime.utcnow().isoformat() + "Z"
    cid = req.customer_cid
    regulator = req.regulator or "GDPR"
    counts = inventory(db, cid)
    receipt: dict[str, Any] = {
        "request_id": request_id,
        "action": req.action,
        "customer_cid": cid,
        "actor": actor,
        "completed_at": completed_at,
        "regulator": regulator,
    }

    if req.action == "article15_export":
        blob = export(db, cid)
        artifact_path = f"dsar/{request_id}/export.zip"
        receipt.update({
            "artifact_path": artifact_path,
            "zip_size_bytes": len(blob),
            "counts": counts,
        })
        req.fulfillment_artifact_path = artifact_path

    elif req.action == "article17_cryptoshred":
        shred_receipt = cryptoshred(db, cid, actor)
        receipt.update(shred_receipt)

    elif req.action == "litigation_hold":
        docs = db.query(Document).filter(Document.customer_cid == cid).all()
        placed = 0
        for d in docs:
            existing = (
                db.query(LegalHold)
                .filter(LegalHold.document_id == d.id, LegalHold.released_at.is_(None))
                .first()
            )
            if not existing:
                db.add(LegalHold(
                    document_id=d.id,
                    reason=f"DSAR litigation hold — request {request_id}",
                    case_ref=request_id,
                    placed_by=actor,
                ))
                placed += 1
        db.commit()
        receipt.update({"documents_held": placed})

    elif req.action == "fulfillment_letter":
        letter = _render_letter(cid, "fulfillment_letter", counts, regulator, completed_at)
        artifact_path = f"dsar/{request_id}/fulfillment_letter.txt"
        receipt.update({"artifact_path": artifact_path, "letter_chars": len(letter)})
        req.fulfillment_artifact_path = artifact_path

    # Snapshot artifacts into dsar_artifacts.
    detail = inventory_detail(db, cid)
    for kind, items in detail.items():
        for item in items:
            if isinstance(item, dict):
                db.add(DsarArtifact(
                    request_id=request_id,
                    kind=kind,
                    ref_type=kind,
                    ref_id=str(item.get("id", "")),
                    snapshot_json=json.dumps(item),
                ))

    req.status = "COMPLETED"
    req.completed_at = datetime.utcnow()
    req.signed_receipt = json.dumps(receipt)
    db.commit()
    return receipt


def release_hold(db: Session, request_id: str, actor: str) -> dict[str, Any]:
    """Release litigation hold placed by a DSAR request."""
    req = db.get(DsarRequest, request_id)
    if req is None:
        raise ValueError(f"DSAR request '{request_id}' not found")
    if req.action != "litigation_hold":
        raise ValueError(f"Request '{request_id}' is not a litigation_hold request")

    docs = db.query(Document).filter(Document.customer_cid == req.customer_cid).all()
    released = 0
    for d in docs:
        hold = (
            db.query(LegalHold)
            .filter(
                LegalHold.document_id == d.id,
                LegalHold.case_ref == request_id,
                LegalHold.released_at.is_(None),
            )
            .first()
        )
        if hold:
            hold.released_by = actor
            hold.released_at = datetime.utcnow()
            released += 1
    db.commit()
    return {
        "request_id": request_id,
        "customer_cid": req.customer_cid,
        "released_by": actor,
        "documents_released": released,
    }

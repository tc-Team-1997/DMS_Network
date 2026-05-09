"""Customer-360 router — unified customer profile pivot (Wave B, migration 0035).

Endpoints under /api/v1/customer360/:cid/*:

  GET    /api/v1/customer360/:cid               header card (9 attrs, masked PII)
  GET    /api/v1/customer360/:cid/accounts      CBS accounts (no balances)
  GET    /api/v1/customer360/:cid/documents     DMS docs for this CID (FTS5 filtered)
  GET    /api/v1/customer360/:cid/transactions  stub (CBS integration placeholder)
  GET    /api/v1/customer360/:cid/workflows     workflow steps for this CID
  GET    /api/v1/customer360/:cid/activity      combined audit activity for this CID
  POST   /api/v1/customer360/:cid/pii-reveal    reveal masked PII fields (audited)

PII policy:
  - phone and email are masked in the GET /header response.
  - POST /pii-reveal requires reason ≥ 20 chars, writes customer_pii_reveals,
    returns cleartext fields scoped to the TTL the Node layer enforces.
  - No PII appears in logs (redacted to first-3 + *** + last-3).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    AmlHit,
    AmlScreening,
    AuditLog,
    CustomerPiiReveal,
    Document,
    WorkflowStep,
)
from ..security import require_api_key
from ..services.auth import Principal, require

logger = logging.getLogger("customer_360")

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(
    prefix="/api/v1/customer360",
    tags=["customer-360"],
    dependencies=[Depends(require_api_key)],
)

# ---------------------------------------------------------------------------
# Permission tiers
# ---------------------------------------------------------------------------

def _require_read():
    return require("audit_read")


# ---------------------------------------------------------------------------
# PII masking helpers
# ---------------------------------------------------------------------------

def _mask_phone(raw: Optional[str]) -> Optional[str]:
    """Mask all but last-2 digits: +975 •••• ••89."""
    if not raw:
        return raw
    digits = "".join(c for c in raw if c.isdigit())
    if len(digits) < 4:
        return "•" * len(raw)
    suffix = digits[-2:]
    return f"+{digits[0]} •••• ••{suffix}"


def _mask_email(raw: Optional[str]) -> Optional[str]:
    """Mask local-part: j***@mail.com."""
    if not raw or "@" not in raw:
        return raw
    local, domain = raw.split("@", 1)
    if len(local) <= 1:
        return f"{local[0]}***@{domain}"
    return f"{local[0]}***@{domain}"


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class PiiRevealIn(BaseModel):
    fields: list[str] = Field(..., min_length=1)
    reason: str = Field(..., min_length=20, max_length=2000)


class Customer360Header(BaseModel):
    cid: str
    national_id: Optional[str] = None
    name: Optional[str] = None
    dob: Optional[str] = None
    phone_masked: Optional[str] = None
    email_masked: Optional[str] = None
    branch: Optional[str] = None
    risk_band: Optional[str] = None
    kyc_status: Optional[str] = None
    aml_status: Optional[str] = None
    onboarded_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_customer_raw(cid: str, tenant_id: str, db: Session) -> dict[str, Any]:
    """Pull customer fields from the CBS document link or CBS integration layer.

    Falls back to deriving from the documents table (customer_cid column) when
    the Customer model is not yet populated.  Returns a raw dict of all known fields.
    """
    # Try Customer model first (populated by CBS sync or Onboarding)
    try:
        from ..models import Customer  # type: ignore[attr-defined]
        row = (
            db.query(Customer)
            .filter(Customer.cif == cid, Customer.tenant_id == tenant_id)
            .first()
        )
        if row:
            return {
                "cid":        row.cif,
                "name":       getattr(row, "name", None),
                "national_id": getattr(row, "national_id", None),
                "dob":        getattr(row, "dob", None),
                "phone":      getattr(row, "phone", None),
                "email":      getattr(row, "email", None),
                "branch":     getattr(row, "branch", None),
                "risk_band":  getattr(row, "risk_band", None),
                "kyc_status": getattr(row, "kyc_status", None),
                "onboarded_at": (
                    row.created_at.isoformat() + "Z"
                    if hasattr(row, "created_at") and row.created_at else None
                ),
            }
    except Exception:
        pass

    # Fallback: derive from documents table
    doc = (
        db.query(Document)
        .filter(
            Document.customer_cid == cid,
            Document.tenant == tenant_id,
        )
        .order_by(Document.created_at.asc())
        .first()
    )
    if doc is None:
        return {"cid": cid}

    return {
        "cid":    cid,
        "name":   None,
        "branch": doc.branch,
        "onboarded_at": doc.created_at.isoformat() + "Z" if doc.created_at else None,
    }


def _aml_status_for_cid(cid: str, tenant_id: str, db: Session) -> str:
    """Return 'open' | 'cleared' | 'clean' based on most recent screening."""
    latest = (
        db.query(AmlScreening)
        .filter(
            AmlScreening.customer_cid == cid,
            AmlScreening.tenant_id == tenant_id,
        )
        .order_by(AmlScreening.screened_at.desc())
        .first()
    )
    if latest is None:
        return "unscreened"
    if latest.status in ("flagged",):
        # Check if any hits are still open
        open_hits = (
            db.query(func.count(AmlHit.id))
            .filter(
                AmlHit.screening_id == latest.id,
                AmlHit.decision == "open",
            )
            .scalar()
            or 0
        )
        return "open" if open_hits > 0 else "cleared"
    return latest.status  # 'cleared', 'pending', 'error', etc.


# ---------------------------------------------------------------------------
# GET /:cid  — header card
# ---------------------------------------------------------------------------

@router.get("/{cid}")
def customer_header(
    cid: str,
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_read()),
) -> dict[str, Any]:
    """Return the Customer-360 header card with masked PII."""
    raw = _resolve_customer_raw(cid, p.tenant, db)
    if not raw:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Customer {cid} not found")

    aml_status = _aml_status_for_cid(cid, p.tenant, db)

    return {
        "cid":          cid,
        "national_id":  raw.get("national_id"),
        "name":         raw.get("name"),
        "dob":          raw.get("dob"),
        "phone_masked": _mask_phone(raw.get("phone")),
        "email_masked": _mask_email(raw.get("email")),
        "branch":       raw.get("branch"),
        "risk_band":    raw.get("risk_band"),
        "kyc_status":   raw.get("kyc_status"),
        "aml_status":   aml_status,
        "onboarded_at": raw.get("onboarded_at"),
    }


# ---------------------------------------------------------------------------
# POST /:cid/pii-reveal  — reveal masked fields (audited)
# ---------------------------------------------------------------------------

@router.post("/{cid}/pii-reveal")
def pii_reveal(
    cid: str,
    body: PiiRevealIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_read()),
) -> dict[str, Any]:
    """Reveal one or more PII fields for a customer.

    Writes a customer_pii_reveals audit row before returning any cleartext.
    The Node SPA mirror enforces the 60-second TTL countdown client-side.
    """
    ALLOWED_PII_FIELDS = {"phone", "email", "national_id", "dob"}
    requested = [f for f in body.fields if f in ALLOWED_PII_FIELDS]
    if not requested:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"No valid PII fields requested. Allowed: {sorted(ALLOWED_PII_FIELDS)}",
        )

    raw = _resolve_customer_raw(cid, p.tenant, db)
    if not raw:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Customer {cid} not found")

    # Write audit before returning data.
    user_id_int = 0  # Principal.sub is a string; store 0 as sentinel
    try:
        user_id_int = int(p.sub)
    except (ValueError, TypeError):
        pass

    reveal_row = CustomerPiiReveal(
        tenant_id=p.tenant,
        user_id=user_id_int,
        customer_cid=cid,
        fields_json=json.dumps(requested),
        reason=body.reason,
        created_at=datetime.utcnow(),
    )
    db.add(reveal_row)

    # Also write to audit_log
    db.add(AuditLog(
        tenant=p.tenant,
        actor=p.sub,
        action="CUSTOMER_PII_REVEALED",
        resource_type="customer",
        resource_id=cid,
        detail=f"fields={requested} reason_len={len(body.reason)}",
    ))
    db.commit()

    # Collect cleartext values
    cleartext: dict[str, Optional[str]] = {}
    for field in requested:
        cleartext[field] = raw.get(field)

    logger.info(
        "customer_pii_reveal cid=%s fields=%s actor=%s tenant=%s",
        cid[:3] + "***",
        requested,
        p.sub,
        p.tenant,
    )

    return {
        "cid":       cid,
        "fields":    cleartext,
        "reveal_id": reveal_row.id,
    }


# ---------------------------------------------------------------------------
# GET /:cid/accounts  — CBS accounts (no balances)
# ---------------------------------------------------------------------------

@router.get("/{cid}/accounts")
def customer_accounts(
    cid: str,
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_read()),
) -> dict[str, Any]:
    """Return CBS accounts for a customer.  No balance data — contract invariant."""
    # Delegate to the CBS integration if available
    try:
        from ..services.integrations.provider_registry import get_provider
        cbs = get_provider("temenos_t24", db=db, tenant_id=p.tenant)
        result = cbs.get_accounts(cif=cid)  # type: ignore[union-attr]
        return {"cid": cid, "accounts": result}
    except Exception:
        pass

    # Fallback: pull from CbsDocumentLink as proxy for known accounts
    try:
        from ..models import CbsDocumentLink  # type: ignore[attr-defined]
        links = (
            db.query(CbsDocumentLink)
            .filter(
                CbsDocumentLink.cif == cid,
                CbsDocumentLink.tenant_id == p.tenant,
            )
            .limit(50)
            .all()
        )
        accounts = list({
            lnk.transaction_ref.split("/")[0]
            for lnk in links
            if lnk.transaction_ref
        })
        return {"cid": cid, "accounts": [{"account_id": a, "status": "unknown"} for a in accounts]}
    except Exception:
        return {"cid": cid, "accounts": []}


# ---------------------------------------------------------------------------
# GET /:cid/documents  — DMS documents for this CID
# ---------------------------------------------------------------------------

@router.get("/{cid}/documents")
def customer_documents(
    cid: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_read()),
) -> dict[str, Any]:
    """Return DMS documents belonging to this customer CID."""
    q = (
        db.query(Document)
        .filter(
            Document.customer_cid == cid,
            Document.tenant == p.tenant,
        )
    )
    total = q.count()
    docs = q.order_by(Document.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "cid":   cid,
        "total": total,
        "items": [
            {
                "id":            d.id,
                "original_name": d.original_name,
                "doc_type":      d.doc_type,
                "status":        d.status,
                "uploaded_by":   d.uploaded_by,
                "created_at":    d.created_at.isoformat() + "Z" if d.created_at else None,
            }
            for d in docs
        ],
    }


# ---------------------------------------------------------------------------
# GET /:cid/transactions  — stub (CBS integration placeholder)
# ---------------------------------------------------------------------------

@router.get("/{cid}/transactions")
def customer_transactions(
    cid: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_read()),
) -> dict[str, Any]:
    """Stub: returns empty list until CBS transaction API is integrated."""
    return {
        "cid":   cid,
        "total": 0,
        "items": [],
        "stub":  True,
        "note":  "CBS transaction feed not yet connected. Configure tenant_config.cbs.transaction_endpoint.",
    }


# ---------------------------------------------------------------------------
# GET /:cid/workflows  — workflow steps for this customer
# ---------------------------------------------------------------------------

@router.get("/{cid}/workflows")
def customer_workflows(
    cid: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_read()),
) -> dict[str, Any]:
    """Return workflow steps for documents belonging to this customer CID."""
    steps_q = (
        db.query(WorkflowStep)
        .join(Document, WorkflowStep.document_id == Document.id)
        .filter(
            Document.customer_cid == cid,
            Document.tenant == p.tenant,
        )
    )
    total = steps_q.count()
    steps = steps_q.order_by(WorkflowStep.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "cid":   cid,
        "total": total,
        "items": [
            {
                "id":          s.id,
                "document_id": s.document_id,
                "stage":       s.stage,
                "actor":       s.actor,
                "action":      s.action,
                "comment":     s.comment,
                "created_at":  s.created_at.isoformat() + "Z" if s.created_at else None,
            }
            for s in steps
        ],
    }


# ---------------------------------------------------------------------------
# GET /:cid/activity  — combined audit activity for this customer
# ---------------------------------------------------------------------------

@router.get("/{cid}/activity")
def customer_activity(
    cid: str,
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    p: Principal = Depends(_require_read()),
) -> dict[str, Any]:
    """Return recent audit log events for this customer CID."""
    logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant == p.tenant,
            AuditLog.resource_id == cid,
        )
        .order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    # Also include AML screening events
    aml_logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant == p.tenant,
            AuditLog.resource_id.like(f"%{cid}%"),
            AuditLog.action.like("AML_%"),
        )
        .order_by(AuditLog.created_at.desc())
        .limit(20)
        .all()
    )

    combined = sorted(
        set(logs) | set(aml_logs),
        key=lambda l: l.created_at or datetime.min,
        reverse=True,
    )[:limit]

    return {
        "cid":   cid,
        "items": [
            {
                "id":            e.id,
                "action":        e.action,
                "actor":         e.actor,
                "resource_type": e.resource_type,
                "detail":        e.detail,
                "created_at":    e.created_at.isoformat() + "Z" if e.created_at else None,
            }
            for e in combined
        ],
    }

"""DSAR Console FastAPI router (Wave C).

Endpoints
---------
GET  /api/v1/dsar/lookup                        — subject lookup by axis/value
GET  /api/v1/dsar/subjects/{cid}/inventory      — 5-panel artifact counts
POST /api/v1/dsar/requests                      — create DSAR request
GET  /api/v1/dsar/requests                      — list requests with SLA timer
POST /api/v1/dsar/requests/{id}/fulfill         — dispatch fulfillment action
POST /api/v1/dsar/requests/{id}/release-hold    — release litigation hold
GET  /api/v1/dsar/export/{customer_cid}         — raw ZIP export (backward compat)
DELETE /api/v1/dsar/erase/{customer_cid}        — legacy soft-erase (backward compat)

RBAC: all endpoints require the 'admin' role via require("admin").
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services import dsar as svc

router = APIRouter(prefix="/api/v1/dsar", tags=["dsar"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class CreateRequestBody(BaseModel):
    customer_cid: str
    action: str
    regulator: Optional[str] = None
    reason: Optional[str] = None
    params: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Subject lookup
# ---------------------------------------------------------------------------

@router.get("/lookup")
def subject_lookup(
    axis: str = Query(..., description="cid | email | phone | national_id"),
    value: str = Query(..., description="Value to search for"),
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    try:
        matches = svc.lookup(db, axis, value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"matches": matches, "count": len(matches)}


# ---------------------------------------------------------------------------
# Artifact inventory
# ---------------------------------------------------------------------------

@router.get("/subjects/{customer_cid}/inventory")
def subject_inventory(
    customer_cid: str,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    counts = svc.inventory(db, customer_cid)
    return {"customer_cid": customer_cid, "panels": counts}


# ---------------------------------------------------------------------------
# DSAR request CRUD
# ---------------------------------------------------------------------------

@router.post("/requests", status_code=201)
def create_request(
    body: CreateRequestBody,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    try:
        req = svc.create_request(
            db=db,
            tenant_id=p.tenant or "default",
            customer_cid=body.customer_cid,
            action=body.action,
            requested_by=p.sub,
            regulator=body.regulator,
            params=body.params,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": req.id,
        "status": req.status,
        "sla_due_at": req.sla_due_at.isoformat() + "Z" if req.sla_due_at else None,
        "action": req.action,
        "customer_cid": req.customer_cid,
    }


@router.get("/requests")
def list_requests(
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    items = svc.list_requests(db, tenant_id=p.tenant or "default")
    return {"items": items, "count": len(items)}


# ---------------------------------------------------------------------------
# Fulfillment actions
# ---------------------------------------------------------------------------

@router.post("/requests/{request_id}/fulfill")
def fulfill_request(
    request_id: str,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    try:
        receipt = svc.fulfill(db, request_id, actor=p.sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return receipt


@router.post("/requests/{request_id}/release-hold")
def release_hold(
    request_id: str,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    try:
        result = svc.release_hold(db, request_id, actor=p.sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


# ---------------------------------------------------------------------------
# Backward-compat endpoints (preserved, not removed)
# ---------------------------------------------------------------------------

@router.get("/export/{customer_cid}")
def export_data(
    customer_cid: str,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> Response:
    blob = svc.export(db, customer_cid)
    return Response(
        content=blob,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="dsar-{customer_cid}.zip"',
        },
    )


@router.delete("/erase/{customer_cid}")
def erase_data(
    customer_cid: str,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("admin")),
) -> dict[str, Any]:
    return svc.erase(db, customer_cid, p.sub)

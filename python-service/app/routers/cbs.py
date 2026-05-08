"""
CBS (Core Banking System) router.

Exposes a unified /api/v1/cbs/* surface over all configured CBS adapters.
Every endpoint requires the shared X-API-Key (require_api_key).

Endpoints
---------
GET  /api/v1/cbs/health
    Returns the health status of every registered adapter for this tenant.

GET  /api/v1/cbs/customers/{cif}
    Pulls a fresh CustomerRecord from CBS and returns it.
    Also upserts the local customers table via kyc_cif.refresh_customer_from_cbs.

GET  /api/v1/cbs/customers/{cif}/accounts
    Lists bank accounts associated with cif from the configured CBS adapter.

POST /api/v1/cbs/customers/{cif}/link-document
    Body: {"document_id": int}
    Writes the DMS→CBS document link and calls adapter.post_document_link.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.integrations.registry import get_adapter, list_adapters
from ..services.integrations.base import AccountRecord, CustomerRecord, HealthStatus
from ..services.integrations.kyc_cif import link_document_to_customer, refresh_customer_from_cbs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/cbs", tags=["CBS"])

# ---------------------------------------------------------------------------
# Default adapter selection — overridden per-request if desired
# ---------------------------------------------------------------------------

_DEFAULT_CBS = os.getenv("DEFAULT_CBS_ADAPTER", "temenos_t24")


# ---------------------------------------------------------------------------
# Request / response shapes
# ---------------------------------------------------------------------------


class LinkDocumentRequest(BaseModel):
    document_id: int


class HealthResponse(BaseModel):
    adapter: str
    ok: bool
    detail: str


class CustomerResponse(BaseModel):
    cif: str
    name: str
    national_id: str
    email: str
    phone: str
    risk_band: str
    kyc_status: str
    raw: dict


class AccountResponse(BaseModel):
    account_no: str
    cif: str
    currency: str
    status: str
    product_code: str
    available_balance: str
    branch_id: str
    open_date: str


class LinkDocumentResponse(BaseModel):
    success: bool
    cif: str
    doc_id: int
    tenant_id: str
    remote_ref: str
    idempotency_key: str
    detail: str


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/health
# ---------------------------------------------------------------------------


@router.get(
    "/health",
    response_model=list[HealthResponse],
    dependencies=[Depends(require_api_key)],
    summary="Health of all configured CBS adapters",
)
async def cbs_health() -> list[dict[str, Any]]:
    """
    Ping every registered adapter and return a list of HealthStatus objects.

    Uses the global INTEGRATIONS_USE_MOCKS / per-adapter env vars to
    select real vs mock adapters — same logic as all other CBS endpoints.
    """
    results: list[dict[str, Any]] = []
    for adapter_name in list_adapters():
        try:
            adapter = await get_adapter(adapter_name, "health-check", {})
            status_obj: HealthStatus = await adapter.health()  # type: ignore[attr-defined]
            results.append({
                "adapter": status_obj.adapter,
                "ok": status_obj.ok,
                "detail": status_obj.detail,
            })
        except Exception as exc:
            logger.warning(
                '{"op": "cbs_health", "adapter": "%s", "status": "error", "error_class": "%s"}',
                adapter_name,
                type(exc).__name__,
            )
            results.append({
                "adapter": adapter_name,
                "ok": False,
                "detail": f"{type(exc).__name__}: {exc}",
            })
    return results


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/customers/{cif}
# ---------------------------------------------------------------------------


@router.get(
    "/customers/{cif}",
    response_model=CustomerResponse,
    dependencies=[Depends(require_api_key)],
    summary="Pull customer from CBS by CIF",
)
async def get_customer(
    cif: str,
    tenant_id: str = "default",
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Fetch a fresh CustomerRecord from CBS and upsert the local customers table.

    Query params:
        tenant_id — tenant context (default: "default")
    """
    result = await refresh_customer_from_cbs(
        cif=cif,
        tenant_id=tenant_id,
        db=db,
        adapter_name=_DEFAULT_CBS,
    )
    if result.customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Customer {cif!r} not found in CBS (adapter: {_DEFAULT_CBS})",
        )
    cr: CustomerRecord = result.customer
    return {
        "cif": cr.cid,
        "name": cr.name,
        "national_id": cr.national_id,
        "email": cr.email,
        "phone": cr.phone,
        "risk_band": cr.risk_band,
        "kyc_status": cr.kyc_status,
        "raw": cr.raw,
    }


# ---------------------------------------------------------------------------
# GET /api/v1/cbs/customers/{cif}/accounts
# ---------------------------------------------------------------------------


@router.get(
    "/customers/{cif}/accounts",
    response_model=list[AccountResponse],
    dependencies=[Depends(require_api_key)],
    summary="List bank accounts for a customer CIF",
)
async def list_accounts(
    cif: str,
    tenant_id: str = "default",
) -> list[dict[str, Any]]:
    """
    Fetch all accounts associated with a customer CIF from CBS.

    Returns a list of AccountResponse objects.  Uses pull_customer to get
    the accounts list embedded in the CBS customer record, supplemented by
    pull_account calls where a dedicated account endpoint exists.
    """
    try:
        adapter = await get_adapter(_DEFAULT_CBS, tenant_id, {})
        # Pull the customer first to get embedded account list
        customer = await adapter.pull_customer(cif)  # type: ignore[attr-defined]
        raw_accounts = customer.raw.get("accounts", [])

        results: list[dict[str, Any]] = []
        for acct in raw_accounts:
            account_id = acct.get("accountId", "")
            if not account_id:
                continue
            # Try to pull full account detail; fall back to summary from customer record
            try:
                acct_record: AccountRecord | None = await adapter.pull_account(account_id)  # type: ignore[attr-defined]
            except Exception:
                acct_record = None

            if acct_record:
                results.append({
                    "account_no": acct_record.account_no,
                    "cif": acct_record.cif,
                    "currency": acct_record.currency,
                    "status": acct_record.status,
                    "product_code": acct_record.product_code,
                    "available_balance": acct_record.available_balance,
                    "branch_id": acct_record.branch_id,
                    "open_date": acct_record.open_date,
                })
            else:
                results.append({
                    "account_no": account_id,
                    "cif": cif,
                    "currency": acct.get("currency", ""),
                    "status": "UNKNOWN",
                    "product_code": acct.get("productCode", ""),
                    "available_balance": "0.00",
                    "branch_id": "",
                    "open_date": acct.get("openingDate", ""),
                })

        return results

    except Exception as exc:
        logger.error(
            '{"op": "list_accounts", "cif": "%s", "tenant_id": "%s", "error_class": "%s"}',
            cif,
            tenant_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"CBS adapter error: {type(exc).__name__}: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# POST /api/v1/cbs/customers/{cif}/link-document
# ---------------------------------------------------------------------------


@router.post(
    "/customers/{cif}/link-document",
    response_model=LinkDocumentResponse,
    dependencies=[Depends(require_api_key)],
    summary="Link a DMS document to a customer in CBS",
    status_code=status.HTTP_200_OK,
)
async def link_document(
    cif: str,
    body: LinkDocumentRequest,
    tenant_id: str = "default",
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Register a DMS document link on CBS for the given CIF.

    Writes the link record to the local customers table and calls
    adapter.post_document_link() upstream.  Idempotent — repeated calls
    with the same (cif, document_id) will not create duplicates.
    """
    result = await link_document_to_customer(
        cif=cif,
        doc_id=body.document_id,
        tenant_id=tenant_id,
        db=db,
        adapter_name=_DEFAULT_CBS,
    )
    return {
        "success": result.success,
        "cif": result.cif,
        "doc_id": result.doc_id,
        "tenant_id": result.tenant_id,
        "remote_ref": result.remote_ref,
        "idempotency_key": result.idempotency_key,
        "detail": result.detail,
    }

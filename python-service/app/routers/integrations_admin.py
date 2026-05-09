"""Admin endpoint for the CC6 integration provider registry.

POST /api/v1/admin/integrations/_reset
  Body: { "tenant_id": str, "kind": str | null }
  Auth: X-API-Key (require_api_key)
  Effect: Calls provider_registry.invalidate(tenant_id, kind) or
          invalidate_tenant(tenant_id) when kind is omitted.
  Returns: { "evicted": int, "tenant_id": str, "kind": str | null }

This endpoint is called by the Node spa-api/admin-config.js PUT handler
whenever namespace='integrations' is written, so that the Python-side
provider cache is busted in lock-step with the config change.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..security import require_api_key
from ..services.integrations.provider_registry import invalidate, invalidate_tenant

router = APIRouter(
    prefix="/api/v1/admin/integrations",
    tags=["integrations-admin"],
    dependencies=[Depends(require_api_key)],
)


class ResetRequest(BaseModel):
    tenant_id: str
    kind: Optional[str] = None


class ResetResponse(BaseModel):
    evicted: int
    tenant_id: str
    kind: Optional[str]


@router.post("/_reset", response_model=ResetResponse)
def reset_provider_cache(body: ResetRequest) -> ResetResponse:
    """Invalidate the provider instance cache for (tenant_id, kind).

    When 'kind' is omitted, all cached providers for *tenant_id* are evicted.
    Each evicted instance has reset() called on it before removal so any held
    resources (SMTP connections, LRU cache contents, model handles) are released.

    Called by the Node admin-config.js PUT handler for namespace='integrations'
    so the cache stays in sync with tenant_config writes.
    """
    if not body.tenant_id or not body.tenant_id.strip():
        raise HTTPException(status_code=400, detail="tenant_id is required")

    if body.kind:
        evicted = invalidate(body.tenant_id, body.kind)
    else:
        evicted = invalidate_tenant(body.tenant_id)

    return ResetResponse(
        evicted=evicted,
        tenant_id=body.tenant_id,
        kind=body.kind,
    )

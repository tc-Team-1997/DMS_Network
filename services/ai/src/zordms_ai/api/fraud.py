from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from zordms_ai.auth import require_auth
from zordms_ai.fraud.rules import DEFAULT_CTR_THRESHOLD, screen

# §5.5 Fraud / AML screening — rule-based (auth required).
fraud_router = APIRouter(prefix="/idp", dependencies=[Depends(require_auth)])


class FraudRequest(BaseModel):
    record: dict[str, Any] = Field(default_factory=dict, examples=[{"amount": 999000, "subject": "ACME Ltd"}])
    watchlist: Optional[list[str]] = Field(default=None, description="Optional screening names (sanctions/PEP).")


@fraud_router.post("/fraud-check")
async def fraud_check_endpoint(body: FraudRequest, request: Request) -> dict:
    """Screen a transaction/party record against rule-based AML detection."""
    threshold = getattr(request.app.state.settings, "aml_ctr_threshold", DEFAULT_CTR_THRESHOLD)
    return screen(body.record, ctr_threshold=threshold, watchlist=body.watchlist)

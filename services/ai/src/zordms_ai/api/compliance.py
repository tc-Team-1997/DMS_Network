from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from zordms_ai.auth import require_auth
from zordms_ai.compliance.rules import validate_compliance

# §5.7 Compliance validation — rule-based regulatory checks (auth required).
compliance_router = APIRouter(prefix="/idp/compliance", dependencies=[Depends(require_auth)])


class ComplianceRequest(BaseModel):
    doc_type: str = Field(..., examples=["BT_CID_4G"])
    data: dict[str, Any] = Field(default_factory=dict)
    as_of: Optional[date] = Field(default=None, description="Evaluation date (defaults to today).")


@compliance_router.post("/validate")
async def validate_endpoint(body: ComplianceRequest) -> dict:
    """Validate a document's extracted data against RMA/FATF regulatory rules."""
    return validate_compliance(body.doc_type, body.data, as_of=body.as_of)

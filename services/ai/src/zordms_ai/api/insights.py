from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from zordms_ai.auth import require_auth
from zordms_ai.insights.narrator import generate_insights

# §SC-01 AI-assisted dashboard narration (auth required).
insights_router = APIRouter(prefix="/idp", dependencies=[Depends(require_auth)])


class InsightsRequest(BaseModel):
    metrics: dict[str, Any] = Field(default_factory=dict, examples=[{"totalDocuments": 1200, "pendingReview": 8, "expiringSoon": 15}])


@insights_router.post("/insights")
async def insights_endpoint(body: InsightsRequest, request: Request) -> dict:
    """Narrate the supplied dashboard metrics (LLM, with deterministic fallback)."""
    return await generate_insights(body.metrics, settings=request.app.state.settings)

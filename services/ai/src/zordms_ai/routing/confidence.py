from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RouteAction(str, Enum):
    AUTO_APPROVE = "AUTO_APPROVE"
    AUTO_VERIFIED = "AUTO_VERIFIED"
    SUPERVISOR_REVIEW = "SUPERVISOR_REVIEW"
    HUMAN_REVIEW = "HUMAN_REVIEW"
    REJECT = "REJECT"


@dataclass(frozen=True)
class RouteDecision:
    band: str
    action: RouteAction
    proceed_to_extract: bool
    review_required: bool
    sla_hours: int | None
    catalog_assignment: str
    sampled_review: bool


def route_by_confidence(confidence: float) -> RouteDecision:
    if confidence >= 0.92:
        return RouteDecision(">=0.92", RouteAction.AUTO_APPROVE, True, False, None, "full", False)
    if confidence >= 0.85:
        return RouteDecision("0.85-0.91", RouteAction.AUTO_VERIFIED, True, False, None, "full", True)
    if confidence >= 0.70:
        return RouteDecision("0.70-0.84", RouteAction.SUPERVISOR_REVIEW, True, True, 48, "tentative", False)
    if confidence >= 0.50:
        return RouteDecision("0.50-0.69", RouteAction.HUMAN_REVIEW, False, True, 24, "pending", False)
    return RouteDecision("<0.50", RouteAction.REJECT, False, True, 0, "none", False)

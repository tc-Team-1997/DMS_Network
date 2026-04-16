from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..services.auth import require, current_principal, Principal
from ..services.abac import allowed

router = APIRouter(prefix="/api/v1/abac", tags=["abac"])


class Check(BaseModel):
    action: str
    resource: dict | None = None
    context: dict | None = None


@router.post("/check")
def check(body: Check, p: Principal = Depends(current_principal)):
    return allowed(p, body.action, body.resource, body.context)


@router.get("/policy-test")
def policy_test(p: Principal = Depends(require("view"))):
    cases = [
        ("view", {}, {}),
        ("admin", {}, {}),
        ("approve", {"tenant": p.tenant, "branch": p.branch,
                     "risk_band": "critical"}, {"stepup_valid": False}),
        ("approve", {"tenant": p.tenant, "branch": p.branch,
                     "risk_band": "critical"}, {"stepup_valid": True}),
    ]
    return [{"case": c[0], "resource": c[1], "context": c[2],
             "decision": allowed(p, c[0], c[1], c[2])} for c in cases]

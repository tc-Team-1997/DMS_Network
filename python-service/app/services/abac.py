"""Attribute-Based Access Control via Open Policy Agent (OPA).

Instead of hard-coded RBAC checks (`require("approve")`), routes can ask:
    allowed(subject, action, resource)

...and OPA returns a decision based on a Rego policy that considers ANY attribute:
  - subject.roles, subject.branch, subject.tenant, subject.mfa_age_sec
  - action.name
  - resource.sensitivity (`low|medium|high|critical`)
  - resource.customer_cid, resource.tenant
  - context.time_of_day_utc, context.ip_country, context.risk_band

Policies live in [opa/policies/dms.rego](../../opa/policies/dms.rego). OPA runs as
a sidecar at OPA_URL (default http://localhost:8181). When OPA is unreachable we
fall back to the existing RBAC matrix so the service keeps answering.
"""
from __future__ import annotations
import os
import time
from typing import Any

import httpx

from .auth import Principal, PERMISSIONS


OPA_URL = os.environ.get("OPA_URL", "").strip()
OPA_PACKAGE = os.environ.get("OPA_PACKAGE", "dms/authz")
OPA_TIMEOUT_SEC = float(os.environ.get("OPA_TIMEOUT_SEC", "0.25"))


def _rbac_fallback(subject: Principal, action: str) -> bool:
    allowed = PERMISSIONS.get(action, set())
    return any(r in allowed for r in subject.roles)


def allowed(principal: Principal, action: str, resource: dict[str, Any] | None = None,
            context: dict[str, Any] | None = None) -> dict:
    """Primary ABAC gate. Returns {allow: bool, via: 'opa'|'rbac', reason: str}."""
    if not OPA_URL:
        return {"allow": _rbac_fallback(principal, action),
                "via": "rbac", "reason": "opa_not_configured"}
    payload = {
        "input": {
            "subject": {
                "sub": principal.sub, "tenant": principal.tenant,
                "branch": principal.branch, "roles": principal.roles,
            },
            "action": {"name": action},
            "resource": resource or {},
            "context": {
                "time_unix": int(time.time()),
                **(context or {}),
            },
        }
    }
    try:
        with httpx.Client(timeout=OPA_TIMEOUT_SEC) as c:
            r = c.post(f"{OPA_URL.rstrip('/')}/v1/data/{OPA_PACKAGE.replace('.', '/')}/allow",
                       json=payload)
            if r.status_code == 200:
                result = r.json().get("result", False)
                if isinstance(result, dict):
                    return {"allow": bool(result.get("allow")), "via": "opa",
                            "reason": result.get("reason", "")}
                return {"allow": bool(result), "via": "opa", "reason": "match"}
    except Exception as e:
        return {"allow": _rbac_fallback(principal, action),
                "via": "rbac", "reason": f"opa_unreachable:{str(e)[:60]}"}
    return {"allow": _rbac_fallback(principal, action),
            "via": "rbac", "reason": "opa_non_200"}


def require_abac(action: str):
    """FastAPI dependency factory — use alongside / instead of require(...)."""
    from fastapi import Depends, HTTPException
    from .auth import current_principal

    async def _dep(p: Principal = Depends(current_principal)) -> Principal:
        d = allowed(p, action)
        if not d["allow"]:
            raise HTTPException(403, {"abac_deny": True, "action": action, **d})
        return p
    return _dep

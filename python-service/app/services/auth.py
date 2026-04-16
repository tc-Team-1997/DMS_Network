"""JWT auth with tenant + role claims.

Claims shape:
    {
      "sub": "ahmed.m",
      "tenant": "nbe",
      "branch": "Cairo West",
      "roles": ["doc_admin"]           # any of: viewer | maker | checker | doc_admin | auditor
    }

Permissions matrix mirrors the HTML mockup:
    capture    → maker, doc_admin
    index      → maker, doc_admin
    approve    → checker, doc_admin
    admin      → doc_admin
    audit_read → auditor, doc_admin
    sign       → checker, doc_admin
"""
from __future__ import annotations
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import jwt, JWTError
from pydantic import BaseModel

from ..config import settings


ALGO = "HS256"

PERMISSIONS = {
    "capture":    {"maker", "doc_admin"},
    "index":      {"maker", "doc_admin"},
    "approve":    {"checker", "doc_admin"},
    "admin":      {"doc_admin"},
    "audit_read": {"auditor", "doc_admin"},
    "sign":       {"checker", "doc_admin"},
    "view":       {"viewer", "maker", "checker", "doc_admin", "auditor"},
}


class Principal(BaseModel):
    sub: str
    tenant: str = "default"
    branch: Optional[str] = None
    roles: list[str] = []

    def has(self, permission: str) -> bool:
        allowed = PERMISSIONS.get(permission, set())
        return any(r in allowed for r in self.roles)


def issue_token(sub: str, tenant: str, branch: Optional[str], roles: list[str],
                ttl_hours: int = 8) -> str:
    now = datetime.utcnow()
    payload = {
        "sub": sub, "tenant": tenant, "branch": branch, "roles": roles,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=ttl_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGO)


def decode_token(token: str) -> Principal:
    try:
        claims = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGO])
    except JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}")
    return Principal(
        sub=claims.get("sub", "anon"),
        tenant=claims.get("tenant", "default"),
        branch=claims.get("branch"),
        roles=claims.get("roles", []),
    )


async def current_principal(
    authorization: str = Header(default=""),
    x_api_key: str = Header(default=""),
) -> Principal:
    """Accept either Bearer JWT or X-API-Key (which grants doc_admin in default tenant)."""
    if authorization.lower().startswith("bearer "):
        return decode_token(authorization.split(" ", 1)[1])
    if x_api_key and x_api_key == settings.API_KEY:
        return Principal(sub="api-key", tenant="default", roles=["doc_admin"])
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing credentials")


def require(permission: str):
    async def _dep(p: Principal = Depends(current_principal)) -> Principal:
        if not p.has(permission):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                f"Role lacks '{permission}' permission")
        return p
    return _dep

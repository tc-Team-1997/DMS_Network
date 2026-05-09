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
    "approve":    {"checker", "doc_admin", "compliance"},
    "admin":      {"doc_admin"},
    "audit_read": {"auditor", "doc_admin", "compliance"},
    "sign":       {"checker", "doc_admin"},
    "view":       {"viewer", "maker", "checker", "doc_admin", "auditor", "compliance"},
    # Wave A backend slugs (worm / redaction / face-match / translate / sync).
    # `kyc:write|read` use the colon convention (matches Node rbac.js); the
    # earlier `kyc_write|read` underscore variants from the face-match agent
    # are dropped. See team-lead reconciliation note in commit message.
    "worm:read":         {"viewer", "maker", "checker", "doc_admin", "auditor", "compliance"},
    "worm:admin":        {"doc_admin"},
    "documents:redact":  {"maker", "checker", "doc_admin"},
    "view_unredacted":   {"doc_admin", "auditor"},
    "kyc:write":         {"maker", "doc_admin"},
    "kyc:read":          {"auditor", "doc_admin"},
    "translate:read":    {"viewer", "maker", "checker", "doc_admin", "auditor", "compliance"},
    "translate:delete":  {"doc_admin"},
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


# ---------------------------------------------------------------------------
# Redaction-specific permission helpers (BHU-46)
# ---------------------------------------------------------------------------

_VIEW_UNREDACTED_ROLES: frozenset[str] = frozenset({"doc_admin", "auditor"})
"""Roles that may access the original (unredacted) version of a document.

Permission slug: ``view_unredacted``.
Only doc_admin and auditor hold this permission. All other roles are served
the redacted copy by default. The team lead must add
``"view_unredacted": {"doc_admin", "auditor"}`` to rbac.js on the Node side.
"""


def principal_can_view_unredacted(p: Principal) -> bool:
    """Return True if the principal holds the ``view_unredacted`` permission.

    Grants access to original (pre-redaction) document content.
    Granted to: doc_admin, auditor.
    """
    return any(r in _VIEW_UNREDACTED_ROLES for r in p.roles)

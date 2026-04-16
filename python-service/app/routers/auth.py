"""Auth endpoints: issue JWT tokens (demo flow — wire to LDAP/SAML in prod).

POST /api/v1/auth/token  { username, password, tenant?, branch?, roles? }
  returns  { access_token, token_type }

In production, replace `_authenticate` with an LDAP / Active Directory / SAML bind.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..services.auth import issue_token, current_principal, Principal


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


DEMO_USERS = {
    "ahmed.m":   {"password": "demo", "tenant": "nbe", "branch": "Cairo West",  "roles": ["doc_admin"]},
    "sara.k":    {"password": "demo", "tenant": "nbe", "branch": "Giza",        "roles": ["maker"]},
    "mohamed.a": {"password": "demo", "tenant": "nbe", "branch": "Alexandria",  "roles": ["checker"]},
    "nour.r":    {"password": "demo", "tenant": "nbe", "branch": "Cairo East",  "roles": ["viewer"]},
    "auditor":   {"password": "demo", "tenant": "nbe", "branch": None,          "roles": ["auditor"]},
}


class TokenIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tenant: str
    branch: str | None
    roles: list[str]


@router.post("/token", response_model=TokenOut)
def token(body: TokenIn):
    u = DEMO_USERS.get(body.username)
    if not u or u["password"] != body.password:
        raise HTTPException(401, "Invalid credentials")
    tok = issue_token(body.username, u["tenant"], u["branch"], u["roles"])
    return TokenOut(access_token=tok, tenant=u["tenant"], branch=u["branch"], roles=u["roles"])


@router.get("/me")
def me(p: Principal = Depends(current_principal)):
    return p.model_dump()

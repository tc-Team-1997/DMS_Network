"""Minimal OIDC 1.0 provider for partner apps.

Supports authorization code flow with PKCE-less client secret exchange
(sufficient for confidential server-side partner apps; add PKCE for SPAs).

Public endpoints:
  /.well-known/openid-configuration      discovery
  /oidc/jwks                              RS256 public key
  /oidc/authorize                         GET — renders a tiny login+consent page
  /oidc/token                             POST — exchanges code for id_token + access_token
  /oidc/userinfo                          GET  — returns claims for the access token

ID tokens are signed RS256 using a persistent keypair stored at storage/keys/oidc.*.pem
(auto-generated on first use).
"""
from __future__ import annotations
import base64
import json
import os
import secrets
from datetime import datetime, timedelta
from pathlib import Path

from jose import jwt as josejwt

from ..config import settings


ISSUER = os.environ.get("OIDC_ISSUER", "http://localhost:8000")
KEYS_DIR = Path(settings.STORAGE_DIR).parent / "keys"
KEYS_DIR.mkdir(parents=True, exist_ok=True)
OIDC_PRIV = KEYS_DIR / "oidc.key.pem"
OIDC_PUB = KEYS_DIR / "oidc.pub.pem"
KID = os.environ.get("OIDC_KID", "nbe-dms-oidc-1")

ID_TOKEN_TTL_MIN = 10
ACCESS_TOKEN_TTL_MIN = 60


def ensure_keys():
    if OIDC_PRIV.exists() and OIDC_PUB.exists():
        return
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    OIDC_PRIV.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    OIDC_PUB.write_bytes(key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ))


def _priv_pem() -> bytes:
    ensure_keys()
    return OIDC_PRIV.read_bytes()


def _pub_pem() -> bytes:
    ensure_keys()
    return OIDC_PUB.read_bytes()


def discovery_document() -> dict:
    return {
        "issuer": ISSUER,
        "authorization_endpoint": f"{ISSUER}/oidc/authorize",
        "token_endpoint": f"{ISSUER}/oidc/token",
        "userinfo_endpoint": f"{ISSUER}/oidc/userinfo",
        "jwks_uri": f"{ISSUER}/oidc/jwks",
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "scopes_supported": ["openid", "profile", "email"],
        "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
        "claims_supported": ["sub", "email", "name", "tenant", "branch", "roles", "iat", "exp"],
    }


def jwks() -> dict:
    """Minimal JWK: derive n,e from the RSA public key."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    pub = serialization.load_pem_public_key(_pub_pem())
    nums = pub.public_numbers()
    def b64u(x: int) -> str:
        raw = x.to_bytes((x.bit_length() + 7) // 8, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    return {"keys": [{"kty": "RSA", "alg": "RS256", "use": "sig", "kid": KID,
                      "n": b64u(nums.n), "e": b64u(nums.e)}]}


def make_id_token(user_sub: str, tenant: str, branch: str | None,
                  roles: list[str], client_id: str, nonce: str | None = None) -> str:
    now = datetime.utcnow()
    payload = {
        "iss": ISSUER, "aud": client_id,
        "sub": user_sub, "tenant": tenant, "branch": branch, "roles": roles,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ID_TOKEN_TTL_MIN)).timestamp()),
    }
    if nonce:
        payload["nonce"] = nonce
    return josejwt.encode(payload, _priv_pem(), algorithm="RS256", headers={"kid": KID})


def make_access_token(user_sub: str, tenant: str, scope: str, client_id: str) -> str:
    now = datetime.utcnow()
    payload = {
        "iss": ISSUER, "aud": client_id, "sub": user_sub, "tenant": tenant,
        "scope": scope,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_TTL_MIN)).timestamp()),
    }
    return josejwt.encode(payload, _priv_pem(), algorithm="RS256", headers={"kid": KID})


def decode_access(token: str) -> dict:
    return josejwt.decode(token, _pub_pem(), algorithms=["RS256"],
                          options={"verify_aud": False})


def new_code() -> str:
    return secrets.token_urlsafe(32)

"""Per-tenant key isolation.

Default envelope encryption uses one bank-wide KEK. In a multi-tenant deployment
(e.g. NBE + sister banks / sub-banks) each tenant should have a DISTINCT KEK so
compromise of one tenant's DEK store cannot affect others.

Strategy:
  - Each tenant maps to a KEK label: the env TENANT_KEK_MAP provides the mapping,
    e.g.  TENANT_KEK_MAP='{"nbe":"arn:aws:kms:...:nbe","audi-eg":"arn:..."}'
  - When wrapping/unwrapping, the lookup is tenant-scoped.
  - Admin endpoints let SREs list and rotate tenant KEKs.

For air-gap / local setups, TENANT_LOCAL_KEKS='{"nbe":"hex64","audi":"hex64"}'
provides per-tenant hex keys.

Reuses the AEAD file envelope from encryption.py so data layout stays identical.
"""
from __future__ import annotations
import json
import os
import secrets
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from ..models import CustomerDek
from . import encryption as env_enc


TENANT_KEK_MAP = json.loads(os.environ.get("TENANT_KEK_MAP", "{}") or "{}")
TENANT_LOCAL_KEKS = json.loads(os.environ.get("TENANT_LOCAL_KEKS", "{}") or "{}")


def _kek_for(tenant: str) -> tuple[str, str]:
    """Return (backend, key_id) for the given tenant."""
    if tenant in TENANT_KEK_MAP:
        arn = TENANT_KEK_MAP[tenant]
        if arn.startswith("arn:aws:kms"):
            return ("aws", arn)
        if arn.startswith("https://"):
            return ("azure", arn)
    if tenant in TENANT_LOCAL_KEKS:
        return ("local", tenant)
    # Fallback to the default bank-wide KEK.
    return (env_enc._kms_backend(), "default")


def _wrap(dek: bytes, backend: str, key_id: str, tenant: str) -> str:
    if backend == "aws":
        import boto3
        kms = boto3.client("kms")
        r = kms.encrypt(KeyId=key_id, Plaintext=dek)
        import base64
        return base64.b64encode(r["CiphertextBlob"]).decode()
    if backend == "azure":
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.keys.crypto import CryptographyClient, KeyWrapAlgorithm
        cred = DefaultAzureCredential()
        crypto = CryptographyClient(key_id, credential=cred)
        r = crypto.wrap_key(KeyWrapAlgorithm.rsa_oaep_256, dek)
        import base64
        return base64.b64encode(r.encrypted_key).decode()
    if backend == "local":
        import base64
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        kek = bytes.fromhex(TENANT_LOCAL_KEKS.get(tenant, ""))
        if len(kek) != 32:
            raise ValueError(f"TENANT_LOCAL_KEKS[{tenant}] must be 64 hex chars")
        nonce = secrets.token_bytes(12)
        ct = AESGCM(kek).encrypt(nonce, dek, tenant.encode())
        return base64.b64encode(nonce + ct).decode()
    return env_enc.wrap_dek(dek)[0]


def _unwrap(wrapped: str, backend: str, key_id: str, tenant: str) -> bytes:
    if backend == "aws":
        import boto3, base64
        kms = boto3.client("kms")
        return kms.decrypt(CiphertextBlob=base64.b64decode(wrapped))["Plaintext"]
    if backend == "azure":
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.keys.crypto import CryptographyClient, KeyWrapAlgorithm
        import base64
        cred = DefaultAzureCredential()
        crypto = CryptographyClient(key_id, credential=cred)
        return crypto.unwrap_key(KeyWrapAlgorithm.rsa_oaep_256,
                                 base64.b64decode(wrapped)).key
    if backend == "local":
        import base64
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        kek = bytes.fromhex(TENANT_LOCAL_KEKS.get(tenant, ""))
        raw = base64.b64decode(wrapped)
        nonce, ct = raw[:12], raw[12:]
        return AESGCM(kek).decrypt(nonce, ct, tenant.encode())
    return env_enc.unwrap_dek(wrapped, key_id)


def get_or_create_tenant_dek(db: Session, tenant: str, customer_cid: str) -> CustomerDek:
    row = db.query(CustomerDek).filter(CustomerDek.customer_cid == customer_cid).first()
    if row:
        return row
    backend, kid = _kek_for(tenant)
    dek = secrets.token_bytes(32)
    wrapped = _wrap(dek, backend, kid, tenant)
    row = CustomerDek(customer_cid=customer_cid, wrapped_dek=wrapped,
                      kms_key_id=f"{tenant}:{kid}")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def plaintext_dek(db: Session, tenant: str, customer_cid: str) -> bytes:
    row = get_or_create_tenant_dek(db, tenant, customer_cid)
    _, kid = (row.kms_key_id or f"{tenant}:default").split(":", 1)
    backend, _ = _kek_for(tenant)
    return _unwrap(row.wrapped_dek, backend, kid, tenant)


def rotate_tenant(db: Session, tenant: str) -> dict:
    """Re-wrap every DEK under a new tenant key version. Call after rotating KEK in KMS."""
    backend, kid = _kek_for(tenant)
    count = 0
    for row in db.query(CustomerDek).all():
        if not row.kms_key_id or not row.kms_key_id.startswith(f"{tenant}:"):
            continue
        dek = plaintext_dek(db, tenant, row.customer_cid)
        row.wrapped_dek = _wrap(dek, backend, kid, tenant)
        row.kms_key_id = f"{tenant}:{kid}"
        row.rotated_at = datetime.utcnow()
        count += 1
    db.commit()
    return {"tenant": tenant, "rotated": count,
            "at": datetime.utcnow().isoformat() + "Z"}


def list_tenants() -> dict:
    all_ = set(TENANT_KEK_MAP.keys()) | set(TENANT_LOCAL_KEKS.keys())
    return {t: _kek_for(t)[0] for t in sorted(all_)} or {"default": env_enc._kms_backend()}

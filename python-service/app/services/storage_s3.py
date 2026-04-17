"""
S3/MinIO content-addressed storage with filesystem fallback.

Keys: `tenants/{tenant_id}/sha256/{aa}/{bb}/{full}` — content-addressed to dedupe
identical uploads across the bank. The tenant prefix is hard-coded for the
multi-tenant migration (Q3 2026 in ROADMAP.md); for now we use `default`.

On-prem / air-gapped deployments point MINIO_ENDPOINT at the customer's own
S3-compatible store. All bytes ride TLS in prod; dev uses plain HTTP to
localhost MinIO.
"""
from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from botocore.config import Config as BotoConfig

log = logging.getLogger(__name__)

# ---------- configuration ---------------------------------------------------

S3_ENDPOINT  = os.environ.get("S3_ENDPOINT",  "http://localhost:9100")
S3_BUCKET    = os.environ.get("S3_BUCKET",    "docmanager")
S3_REGION    = os.environ.get("S3_REGION",    "us-east-1")
S3_ACCESS    = os.environ.get("S3_ACCESS_KEY", "docmanager")
S3_SECRET    = os.environ.get("S3_SECRET_KEY", "docmanager-local-dev-secret")
TENANT_ID    = os.environ.get("TENANT_ID",    "default")

FS_FALLBACK  = Path(os.environ.get("STORAGE_DIR", "./storage/documents"))


@dataclass(frozen=True)
class StoredObject:
    """Metadata about a persisted object."""
    key:        str       # S3 key or filesystem path relative to FS_FALLBACK
    sha256:     str       # hex
    size:       int       # bytes
    backend:    str       # 's3' or 'fs'


# ---------- backend singletons ---------------------------------------------

_s3_client = None
_s3_healthy: Optional[bool] = None


def _s3():
    """Lazy-create boto3 client; called on every op so tests can monkey-patch."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS,
            aws_secret_access_key=S3_SECRET,
            region_name=S3_REGION,
            config=BotoConfig(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=3,
                read_timeout=10,
            ),
        )
    return _s3_client


def _s3_is_up() -> bool:
    """Cheap health probe. Cached per process; resets via `reset_health()`."""
    global _s3_healthy
    if _s3_healthy is not None:
        return _s3_healthy
    try:
        _s3().head_bucket(Bucket=S3_BUCKET)
        _s3_healthy = True
    except (BotoCoreError, ClientError, OSError) as exc:
        log.warning("S3 backend unreachable (%s); falling back to filesystem", exc)
        _s3_healthy = False
    return _s3_healthy


def reset_health() -> None:
    """Force a re-probe on next call. Useful in tests."""
    global _s3_healthy
    _s3_healthy = None


# ---------- public API ------------------------------------------------------

def _cas_key(digest: str, tenant_id: str = TENANT_ID) -> str:
    return f"tenants/{tenant_id}/sha256/{digest[:2]}/{digest[2:4]}/{digest}"


def put(data: bytes, *, tenant_id: str = TENANT_ID) -> StoredObject:
    """Persist bytes; idempotent by sha256. Returns the stored-object handle."""
    digest = hashlib.sha256(data).hexdigest()
    size = len(data)
    key = _cas_key(digest, tenant_id)

    if _s3_is_up():
        try:
            _s3().put_object(
                Bucket=S3_BUCKET, Key=key, Body=data,
                ContentType="application/octet-stream",
                Metadata={"sha256": digest, "tenant": tenant_id},
            )
            return StoredObject(key=key, sha256=digest, size=size, backend="s3")
        except (BotoCoreError, ClientError) as exc:
            log.warning("S3 put failed, falling back to fs: %s", exc)
            reset_health()

    # Filesystem fallback
    path = FS_FALLBACK / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return StoredObject(key=key, sha256=digest, size=size, backend="fs")


def get(key: str) -> bytes:
    """Read bytes by key. Tries S3 then filesystem."""
    if _s3_is_up():
        try:
            obj = _s3().get_object(Bucket=S3_BUCKET, Key=key)
            return obj["Body"].read()
        except (BotoCoreError, ClientError) as exc:
            log.debug("S3 get miss for %s: %s; trying fs", key, exc)

    path = FS_FALLBACK / key
    if path.exists():
        return path.read_bytes()
    raise FileNotFoundError(f"object not found: {key}")


def presigned_url(key: str, *, expires: int = 300) -> str:
    """Time-boxed signed URL for browser download. S3 only."""
    if not _s3_is_up():
        raise RuntimeError("presigned URLs require S3 backend")
    return _s3().generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=expires,
    )


def health() -> dict:
    """Backend status for /health endpoints."""
    up = _s3_is_up()
    return {
        "backend": "s3" if up else "fs",
        "s3_endpoint": S3_ENDPOINT,
        "s3_bucket":   S3_BUCKET,
        "s3_healthy":  up,
        "fs_fallback": str(FS_FALLBACK),
    }

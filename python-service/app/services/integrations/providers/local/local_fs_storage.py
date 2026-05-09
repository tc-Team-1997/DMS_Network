"""LocalFsStorage — delegates to services/storage_s3.py (S3/MinIO + FS fallback).

The existing storage_s3 module is content-addressed (SHA-256 keyed) and has
an S3/MinIO primary path with an automatic filesystem fallback. This provider
wraps that surface without reimplementing it.

delete() is not present in storage_s3.py; we implement a filesystem-only
delete and log a warning when the S3 backend is active, since object-lock
policies may prevent deletion in WORM contexts.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from ...providers_base import StorageProvider

log = logging.getLogger(__name__)

_FS_FALLBACK = Path(os.environ.get("STORAGE_DIR", "./storage/documents"))


class LocalFsStorage(StorageProvider):
    """Storage provider backed by services/storage_s3.py (S3 + FS fallback).

    put() and get() delegate directly to the existing content-addressed
    storage module. delete() operates on the filesystem fallback path only;
    if the object resides on S3 a warning is logged (S3 delete requires
    boto3 permissions not guaranteed in local/WORM deployments).
    """

    def put(self, key: str, data: bytes) -> str:
        """Persist *data* using the existing content-addressed storage.

        The *key* argument is used as a fallback path hint; the actual stored
        key is always the SHA-256 content-address returned by storage_s3.put().
        """
        try:
            from app.services import storage_s3
        except ImportError:
            log.error("LocalFsStorage: storage_s3 not available; writing to FS directly")
            path = _FS_FALLBACK / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return key

        obj = storage_s3.put(data)
        return obj.key

    def get(self, key: str) -> bytes:
        """Retrieve bytes by *key* (S3 with FS fallback)."""
        try:
            from app.services import storage_s3
            return storage_s3.get(key)
        except ImportError:
            path = _FS_FALLBACK / key
            if path.exists():
                return path.read_bytes()
            raise FileNotFoundError(f"object not found: {key}")

    def delete(self, key: str) -> None:
        """Delete the object at *key* from the filesystem fallback path.

        S3 deletion is NOT performed here — object-lock (WORM) policies may
        prohibit it, and boto3 delete requires additional IAM permissions.
        Log a warning if the S3 backend is active so operators are aware.
        """
        try:
            from app.services import storage_s3
            if storage_s3._s3_is_up():
                log.warning(
                    "LocalFsStorage.delete(%r): S3 backend is active. "
                    "S3-side deletion is not performed by this provider. "
                    "Use the AWS console or aws s3 rm to remove the object from S3.",
                    key,
                )
        except Exception:
            pass

        path = _FS_FALLBACK / key
        if path.exists():
            path.unlink()
            log.debug("LocalFsStorage.delete: removed %s", path)

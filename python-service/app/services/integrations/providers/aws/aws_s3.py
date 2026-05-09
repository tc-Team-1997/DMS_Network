"""AWS S3 storage stub — registered but NOT enabled by default.

Note: storage_s3.py already uses boto3 + S3/MinIO for the primary storage path.
This stub is for a *pure-AWS-S3* provider that bypasses the MinIO/FS fallback
and talks directly to AWS S3. Useful when deploying on AWS rather than on-prem.
"""
from __future__ import annotations

from ...providers_base import StorageProvider

_MSG = (
    "AWS S3 adapter is registered but not enabled. "
    "Set integrations.storage.provider='aws' in tenant_config and provide "
    "AWS credentials (S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION). "
    "boto3 must be installed separately: pip install boto3. "
    "Note: the local 'storage' provider already uses S3/MinIO via storage_s3.py — "
    "this stub targets pure-AWS-S3 without the MinIO/FS fallback."
)


class S3Storage(StorageProvider):
    """AWS S3 storage stub."""

    def put(self, key: str, data: bytes) -> str:
        raise NotImplementedError(_MSG)

    def get(self, key: str) -> bytes:
        raise NotImplementedError(_MSG)

    def delete(self, key: str) -> None:
        raise NotImplementedError(_MSG)

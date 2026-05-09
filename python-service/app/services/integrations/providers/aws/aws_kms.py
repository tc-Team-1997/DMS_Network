"""AWS KMS stub — registered but NOT enabled by default."""
from __future__ import annotations

from ...providers_base import KmsProvider

_MSG = (
    "AWS KMS adapter is registered but not enabled. "
    "Set integrations.kms.provider='aws' in tenant_config and provide "
    "AWS credentials (AWS_KMS_KEY_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY). "
    "boto3 must be installed separately: pip install boto3"
)


class AwsKms(KmsProvider):
    """AWS KMS envelope encryption stub."""

    def encrypt(self, plaintext: bytes, *, key_id: str) -> bytes:
        raise NotImplementedError(_MSG)

    def decrypt(self, ciphertext: bytes, *, key_id: str) -> bytes:
        raise NotImplementedError(_MSG)

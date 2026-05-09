"""AWS SNS SMS stub — registered but NOT enabled by default."""
from __future__ import annotations

from ...providers_base import SmsProvider, SmsResult

_MSG = (
    "AWS SNS adapter is registered but not enabled. "
    "Set integrations.sms.provider='aws' in tenant_config and provide "
    "AWS credentials. boto3 must be installed separately: pip install boto3"
)


class SnsSms(SmsProvider):
    """AWS SNS SMS stub."""

    def send(self, to: str, body: str) -> SmsResult:
        raise NotImplementedError(_MSG)

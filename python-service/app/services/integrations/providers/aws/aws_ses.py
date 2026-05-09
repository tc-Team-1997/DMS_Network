"""AWS SES email stub — registered but NOT enabled by default."""
from __future__ import annotations

from typing import Optional

from ...providers_base import EmailProvider, EmailResult

_MSG = (
    "AWS SES adapter is registered but not enabled. "
    "Set integrations.email.provider='aws' in tenant_config and provide "
    "AWS credentials. boto3 must be installed separately: pip install boto3"
)


class SesEmail(EmailProvider):
    """AWS SES email stub."""

    def send(self, *, to: str, subject: str, body: str, html: Optional[str] = None) -> EmailResult:
        raise NotImplementedError(_MSG)

"""NoopSms — no-operation SMS provider for local development.

Logs the message that would be sent and returns success. No external calls.
Real SMS (Bhutan Telecom API, Twilio, AWS SNS) is a future adapter registered
in the registry with provider_name='aws' or 'bt_sms'.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging

from ...providers_base import SmsProvider, SmsResult

log = logging.getLogger(__name__)


class NoopSms(SmsProvider):
    """SMS provider stub that logs instead of sending.

    Used in local development and CI to prevent accidental SMS sends when
    real phone numbers appear in test data. Returns ok=True so callers
    do not need to handle errors in their happy path.
    """

    def send(self, to: str, body: str) -> SmsResult:
        """Log the would-be SMS and return a success result.

        Args:
            to:   E.164 phone number.
            body: SMS message body.

        Returns:
            SmsResult(ok=True) always.
        """
        log.info("[noop_sms] would send to %s: %s", to, body)
        return SmsResult(ok=True, message_id="noop", detail="logged only — noop provider")

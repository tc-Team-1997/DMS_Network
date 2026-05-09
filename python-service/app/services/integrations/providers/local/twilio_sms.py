"""TwilioSms — Twilio Programmable SMS registered in the CC6 provider registry.

Classified under local-first providers because it is tenant-configurable via
tenant_config (no global AWS credentials needed).

Required env vars (or set in deployment secrets):
    TWILIO_ACCOUNT_SID  — Twilio account SID (starts with AC…)
    TWILIO_AUTH_TOKEN   — Twilio auth token
    TWILIO_FROM         — Twilio-provisioned phone number in E.164 e.g. +1234567890

If TWILIO_ACCOUNT_SID is not set the provider logs a warning and returns
SmsResult(ok=False) without raising an exception, so callers do not need to
handle errors in their happy path.

This class replaces the old app/services/notify/sms.py Twilio shim.
All callers should go through:
    get_provider(db, tenant_id, 'sms').send(to, body)
"""
from __future__ import annotations

import logging
import os

from ...providers_base import SmsProvider, SmsResult

log = logging.getLogger(__name__)


class TwilioSms(SmsProvider):
    """Twilio Programmable SMS — CC6 SmsProvider implementation.

    Reads credentials from environment variables on every instantiation.
    The registry caches the instance; call invalidate(tenant_id, 'sms') to
    force a refresh when credentials change at runtime.
    """

    def __init__(self) -> None:
        self.account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
        self.auth_token  = os.environ.get("TWILIO_AUTH_TOKEN", "")
        self.from_number = os.environ.get("TWILIO_FROM", "")

        if not self.account_sid:
            log.warning(
                "TwilioSms: TWILIO_ACCOUNT_SID not set — SMS provider in no-op mode"
            )

    @property
    def configured(self) -> bool:
        return bool(self.account_sid and self.auth_token and self.from_number)

    def send(self, to: str, body: str) -> SmsResult:
        """Send an SMS via Twilio REST API.

        Args:
            to:   E.164 phone number of the recipient (e.g. '+97517123456').
            body: Message text. Max 160 chars for a single SMS segment.

        Returns:
            SmsResult(ok=True, message_id=<sid>) on success.
            SmsResult(ok=False, detail=<error>) on failure or when not configured.
        """
        if not self.configured:
            log.warning("TwilioSms.send: skipping to %s — Twilio credentials not configured", to)
            return SmsResult(ok=False, detail="Twilio credentials not configured")

        try:
            # Twilio REST client is synchronous; call is safe in a thread-pool
            # executor context (FastAPI background tasks, Celery, etc.).
            from twilio.rest import Client  # deferred import — optional dependency

            client = Client(self.account_sid, self.auth_token)
            message = client.messages.create(
                body=body,
                from_=self.from_number,
                to=to,
            )
            log.info("TwilioSms.send: sent to %s sid=%s", to, message.sid)
            return SmsResult(ok=True, message_id=message.sid)

        except Exception as exc:
            log.error("TwilioSms.send: failed to send to %s: %s", to, exc)
            return SmsResult(ok=False, detail=str(exc))

    def reset(self) -> None:
        """No persistent connections to release."""

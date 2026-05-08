"""SMS provider via Twilio Programmable SMS.

Required env vars:
    TWILIO_ACCOUNT_SID  — Twilio account SID (starts with AC…)
    TWILIO_AUTH_TOKEN   — Twilio auth token
    TWILIO_FROM         — Twilio-provisioned phone number, e.g. +1234567890

If TWILIO_ACCOUNT_SID is not set the provider logs a warning and returns
ok=False without raising an exception.
"""
from __future__ import annotations

import logging
import os

from .base import Provider, ProviderResult

log = logging.getLogger(__name__)


class SmsProvider(Provider):
    def __init__(self) -> None:
        self.account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
        self.auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
        self.from_number = os.environ.get("TWILIO_FROM", "")

        if not self.account_sid:
            log.warning("notify/sms: TWILIO_ACCOUNT_SID not set — SMS provider in no-op mode")

    @property
    def configured(self) -> bool:
        return bool(self.account_sid and self.auth_token and self.from_number)

    async def send(self, to: str, subject: str, body: str, **extra) -> ProviderResult:
        if not self.configured:
            log.warning("notify/sms: skipping send to %s — Twilio credentials not configured", to)
            return {"ok": False, "error": "Twilio credentials not configured"}

        try:
            import asyncio
            from twilio.rest import Client  # deferred import

            full_body = f"[{subject}] {body}" if subject else body

            client = Client(self.account_sid, self.auth_token)

            # Twilio REST client is synchronous; run in executor to avoid blocking event loop
            loop = asyncio.get_event_loop()
            message = await loop.run_in_executor(
                None,
                lambda: client.messages.create(
                    body=full_body,
                    from_=self.from_number,
                    to=to,
                ),
            )

            log.info("notify/sms: sent to %s sid=%s", to, message.sid)
            return {"ok": True, "id": message.sid}

        except Exception as exc:
            log.error("notify/sms: failed to send to %s: %s", to, exc)
            return {"ok": False, "error": str(exc)}

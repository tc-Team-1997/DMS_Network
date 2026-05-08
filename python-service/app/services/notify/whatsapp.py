"""WhatsApp Business provider via Twilio WhatsApp API.

Reuses Twilio credentials but sends from a WhatsApp-enabled sender.

Required env vars:
    TWILIO_ACCOUNT_SID  — shared with SMS provider
    TWILIO_AUTH_TOKEN   — shared with SMS provider
    TWILIO_WA_FROM      — WhatsApp-enabled number, e.g. whatsapp:+14155238886

The ``to`` address passed to send() should be a plain E.164 number
(+XXXXX); this provider automatically prefixes ``whatsapp:`` on both ends.

If TWILIO_ACCOUNT_SID or TWILIO_WA_FROM is not set the provider logs a
warning and returns ok=False without raising an exception.
"""
from __future__ import annotations

import logging
import os

from .base import Provider, ProviderResult

log = logging.getLogger(__name__)


class WhatsAppProvider(Provider):
    def __init__(self) -> None:
        self.account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
        self.auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
        self.from_number = os.environ.get("TWILIO_WA_FROM", "")

        if not self.account_sid or not self.from_number:
            log.warning(
                "notify/whatsapp: TWILIO_ACCOUNT_SID or TWILIO_WA_FROM not set "
                "— WhatsApp provider in no-op mode"
            )

    @property
    def configured(self) -> bool:
        return bool(self.account_sid and self.auth_token and self.from_number)

    async def send(self, to: str, subject: str, body: str, **extra) -> ProviderResult:
        if not self.configured:
            log.warning(
                "notify/whatsapp: skipping send to %s — Twilio WA credentials not configured", to
            )
            return {"ok": False, "error": "Twilio WhatsApp credentials not configured"}

        try:
            import asyncio
            from twilio.rest import Client  # deferred import

            full_body = f"[{subject}] {body}" if subject else body

            # Normalise to/from addresses
            wa_to = to if to.startswith("whatsapp:") else f"whatsapp:{to}"
            wa_from = (
                self.from_number
                if self.from_number.startswith("whatsapp:")
                else f"whatsapp:{self.from_number}"
            )

            client = Client(self.account_sid, self.auth_token)

            loop = asyncio.get_event_loop()
            message = await loop.run_in_executor(
                None,
                lambda: client.messages.create(
                    body=full_body,
                    from_=wa_from,
                    to=wa_to,
                ),
            )

            log.info("notify/whatsapp: sent to %s sid=%s", to, message.sid)
            return {"ok": True, "id": message.sid}

        except Exception as exc:
            log.error("notify/whatsapp: failed to send to %s: %s", to, exc)
            return {"ok": False, "error": str(exc)}

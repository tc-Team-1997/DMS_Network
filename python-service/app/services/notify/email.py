"""Email provider via aiosmtplib.

Required env vars:
    SMTP_HOST   — SMTP server hostname
    SMTP_PORT   — port (default 587 for STARTTLS, 465 for SSL)
    SMTP_USER   — login username
    SMTP_PASS   — login password
    SMTP_FROM   — envelope From address
    SMTP_TLS    — "ssl" for implicit TLS (port 465), anything else → STARTTLS
                  (default: STARTTLS)

If SMTP_HOST is not set the provider logs a warning and returns ok=False
without raising an exception.
"""
from __future__ import annotations

import logging
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from .base import Provider, ProviderResult

log = logging.getLogger(__name__)


class EmailProvider(Provider):
    def __init__(self) -> None:
        self.host = os.environ.get("SMTP_HOST", "")
        self.port = int(os.environ.get("SMTP_PORT", "587"))
        self.user = os.environ.get("SMTP_USER", "")
        self.password = os.environ.get("SMTP_PASS", "")
        self.from_addr = os.environ.get("SMTP_FROM", self.user)
        self.use_ssl = os.environ.get("SMTP_TLS", "").lower() == "ssl"

        if not self.host:
            log.warning("notify/email: SMTP_HOST not set — email provider in no-op mode")

    @property
    def configured(self) -> bool:
        return bool(self.host)

    async def send(self, to: str, subject: str, body: str, **extra) -> ProviderResult:
        if not self.configured:
            log.warning("notify/email: skipping send to %s — SMTP_HOST not configured", to)
            return {"ok": False, "error": "SMTP_HOST not configured"}

        try:
            import aiosmtplib  # deferred so tests without the package still import

            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = self.from_addr
            msg["To"] = to
            msg.attach(MIMEText(body, "plain"))

            if self.use_ssl:
                smtp = aiosmtplib.SMTP(
                    hostname=self.host,
                    port=self.port,
                    use_tls=True,
                )
            else:
                smtp = aiosmtplib.SMTP(
                    hostname=self.host,
                    port=self.port,
                    start_tls=True,
                )

            async with smtp:
                if self.user:
                    await smtp.login(self.user, self.password)
                result = await smtp.send_message(msg)

            # aiosmtplib returns a dict of {recipient: (code, msg)}
            # We treat it as success if we get here without exception.
            msg_id = str(result) if result else ""
            log.info("notify/email: sent to %s subject=%r", to, subject)
            return {"ok": True, "id": msg_id}

        except Exception as exc:
            log.error("notify/email: failed to send to %s: %s", to, exc)
            return {"ok": False, "error": str(exc)}

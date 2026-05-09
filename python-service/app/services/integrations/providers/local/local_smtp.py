"""LocalSmtp — synchronous SMTP email provider backed by smtplib.

Config keys (read from tenant_config namespace 'notifications' on every call):
    email.host      SMTP server hostname       default: 'localhost'
    email.port      SMTP port                  default: 25
    email.username  Login username             default: '' (anonymous)
    email.password  Login password (plaintext) default: ''
    email.from      Envelope From address      default: email.username or 'dms@localhost'

Security note: passwords are stored as plaintext in tenant_config for now.
TODO: wire through KmsProvider.decrypt() before reading the password field
so credentials are stored encrypted at rest. Flag this in the security review.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from ...providers_base import EmailProvider, EmailResult

log = logging.getLogger(__name__)


class LocalSmtp(EmailProvider):
    """Synchronous SMTP email provider using stdlib smtplib.

    Reads connection config from tenant_config namespace 'notifications' on
    every call so hot-config changes take effect without a process restart.

    If the namespace has no rows the provider falls back to localhost:25
    (unauthenticated) which works out-of-the-box in many local dev setups
    (Mailpit, MailHog, Postfix on localhost).

    Security: passwords are stored as plaintext in tenant_config until the
    KmsProvider integration is wired. See TODO above.
    """

    def __init__(self, db=None, tenant_id: str = "default") -> None:
        # db and tenant_id are optional; the registry may inject them in future.
        # For now the provider reads env-level fallbacks if db is not supplied.
        self._db = db
        self._tenant_id = tenant_id

    def _cfg(self, key: str, default: str) -> str:
        """Read a config key from tenant_config or fall back to *default*."""
        if self._db is None:
            return default
        try:
            from app.services.tenant_config import get as cfg_get
            val = cfg_get(self._db, self._tenant_id, "notifications", key, default=default)
            return str(val) if val is not None else default
        except Exception:
            return default

    def send(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        html: Optional[str] = None,
    ) -> EmailResult:
        """Send an email via the configured SMTP server.

        Reads host/port/credentials from tenant_config 'notifications' namespace
        on every call. Falls back to localhost:25 anonymous if unconfigured.
        """
        host = self._cfg("email.host", "localhost")
        port = int(self._cfg("email.port", "25"))
        username = self._cfg("email.username", "")
        # TODO: decrypt password via KmsProvider before use.
        password = self._cfg("email.password", "")
        from_addr = self._cfg("email.from", username or "dms@localhost")

        if html:
            msg = MIMEMultipart("alternative")
            msg.attach(MIMEText(body, "plain", "utf-8"))
            msg.attach(MIMEText(html, "html", "utf-8"))
        else:
            msg = MIMEMultipart()
            msg.attach(MIMEText(body, "plain", "utf-8"))

        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to

        try:
            with smtplib.SMTP(host, port, timeout=10) as smtp:
                smtp.ehlo_or_helo_if_needed()
                # Opportunistic STARTTLS if the server supports it.
                try:
                    smtp.starttls()
                    smtp.ehlo()
                except smtplib.SMTPException:
                    pass  # Server does not support STARTTLS — continue plaintext.
                if username and password:
                    smtp.login(username, password)
                smtp.sendmail(from_addr, [to], msg.as_string())
            log.info("LocalSmtp: sent to=%s subject=%r via %s:%d", to, subject, host, port)
            return EmailResult(ok=True, message_id="", detail=f"sent via {host}:{port}")
        except Exception as exc:
            log.error("LocalSmtp: failed to send to=%s: %s", to, exc)
            return EmailResult(ok=False, detail=str(exc))

    def reset(self) -> None:
        """No persistent connections to release."""

"""Pluggable multi-channel notification layer.

Public API
----------
    from app.services.notify import send

    results = await send(
        user_id="ahmed.m",
        event_type="document_expiry",
        subject="[WARNING] Document expiring soon",
        body="Passport ID-123 expires in 5 days.",
        channels=None,          # None → use DB prefs, falls back to ["email"]
        db=db_session,          # SQLAlchemy Session; optional but needed for pref lookup
        to_override=None,       # dict[channel, address] to bypass DB address lookup
    )
    # returns {"email": {"ok": True, "id": "..."}, "sms": {"ok": False, "error": "..."}}

Channel keys: "email" | "sms" | "whatsapp"

Wave C: SMS is now routed through the CC6 provider registry (TwilioSms / NoopSms /
SnsSms). The old notify/sms.py and notify/whatsapp.py shims have been deleted.
WhatsApp remains a stub that logs the call until a WA Business API adapter ships.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from .base import Provider, ProviderResult
from .email import EmailProvider

log = logging.getLogger(__name__)


class _WhatsAppStub(Provider):
    """Placeholder until a WhatsApp Business API adapter ships."""

    configured: bool = False

    async def send(self, to: str, subject: str, body: str, **extra) -> ProviderResult:
        log.warning("notify/whatsapp: stub provider — send to %s not delivered", to)
        return {"ok": False, "error": "whatsapp provider not configured"}


# Singleton provider instances (constructed once at import; reads env vars).
# SMS is no longer here — it is resolved per-call via the CC6 provider registry
# (get_provider(db, tenant_id, 'sms')) so the correct provider (noop/twilio/aws)
# is selected based on tenant_config.  The email and whatsapp entries remain for
# the legacy /api/v1/notify/* router surface.
_providers: dict[str, Provider] = {
    "email": EmailProvider(),
    "whatsapp": _WhatsAppStub(),
}

_DEFAULT_CHANNELS = ["email"]


def _get_channels(user_id: str, channels_override: Optional[list[str]], db) -> list[str]:
    """Resolve which channels to use.

    Priority:
    1. Explicit ``channels_override`` argument.
    2. ``user_notification_preferences.notification_channels`` DB row.
    3. Hard-coded default: ["email"].
    """
    if channels_override is not None:
        return channels_override

    if db is not None:
        try:
            from ...models import UserNotificationPreference  # local import avoids circularity
            pref = (
                db.query(UserNotificationPreference)
                .filter(UserNotificationPreference.user_sub == user_id)
                .first()
            )
            if pref and pref.notification_channels:
                parsed = json.loads(pref.notification_channels)
                if isinstance(parsed, list) and parsed:
                    return parsed
        except Exception as exc:
            log.warning("notify: could not fetch preferences for %s: %s", user_id, exc)

    return _DEFAULT_CHANNELS


def _get_address(user_id: str, channel: str, db, to_override: Optional[dict]) -> Optional[str]:
    """Resolve the destination address for a channel.

    Lookup order:
    1. ``to_override[channel]`` if provided.
    2. ``user_notification_preferences`` DB row (email / phone columns).
    3. Fall through — caller must provide to_override for non-email channels.
    """
    if to_override and channel in to_override:
        return to_override[channel]

    if db is not None:
        try:
            from ...models import UserNotificationPreference
            pref = (
                db.query(UserNotificationPreference)
                .filter(UserNotificationPreference.user_sub == user_id)
                .first()
            )
            if pref:
                if channel == "email" and pref.email:
                    return pref.email
                if channel in ("sms", "whatsapp") and pref.phone:
                    return pref.phone
        except Exception as exc:
            log.warning("notify: could not fetch address for %s/%s: %s", user_id, channel, exc)

    return None


async def send(
    user_id: str,
    event_type: str,
    subject: str,
    body: str,
    *,
    channels: Optional[list[str]] = None,
    db=None,
    to_override: Optional[dict[str, str]] = None,
) -> dict[str, ProviderResult]:
    """Fire notifications across resolved channels.

    For the 'sms' channel, resolves the CC6 provider from the registry when a
    db session is available. Falls back to a no-op result when db is None.

    Never raises — per-channel failures are captured in the returned dict.
    """
    resolved_channels = _get_channels(user_id, channels, db)
    results: dict[str, ProviderResult] = {}

    for channel in resolved_channels:
        # SMS: delegate to CC6 provider registry.
        if channel == "sms":
            to_addr = _get_address(user_id, channel, db, to_override)
            if not to_addr:
                log.warning("notify: no phone for user=%s event=%s — skipping sms", user_id, event_type)
                results[channel] = {"ok": False, "error": "no destination address"}
                continue
            if db is None:
                results[channel] = {"ok": False, "error": "db required for CC6 sms provider lookup"}
                continue
            try:
                from ..integrations.provider_registry import get_provider as _get_provider
                sms_provider = _get_provider(db, "default", "sms")
                sms_result = sms_provider.send(to=to_addr, body=f"[{subject}] {body}")
                results[channel] = {"ok": sms_result.ok, "error": sms_result.detail or ""}
            except Exception as exc:
                log.error("notify: sms CC6 provider error for %s: %s", user_id, exc)
                results[channel] = {"ok": False, "error": str(exc)}
            continue

        provider = _providers.get(channel)
        if provider is None:
            log.warning("notify: unknown channel %r — skipping", channel)
            results[channel] = {"ok": False, "error": f"unknown channel '{channel}'"}
            continue

        to_addr = _get_address(user_id, channel, db, to_override)
        if not to_addr:
            log.warning(
                "notify: no address for user=%s channel=%s event=%s — skipping",
                user_id, channel, event_type,
            )
            results[channel] = {"ok": False, "error": "no destination address"}
            continue

        try:
            result = await provider.send(to=to_addr, subject=subject, body=body,
                                         event_type=event_type, user_id=user_id)
        except Exception as exc:
            log.error("notify: unhandled error for %s/%s: %s", user_id, channel, exc)
            result = {"ok": False, "error": str(exc)}

        results[channel] = result

    return results


def provider_status() -> dict[str, dict]:
    """Return configuration status of all providers (no credentials leaked)."""
    return {
        name: {"configured": getattr(p, "configured", False)}
        for name, p in _providers.items()
    }

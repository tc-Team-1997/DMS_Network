"""Multi-channel notification router (BRD #24).

Endpoints
---------
GET  /api/v1/notify/health         — which providers are configured (no creds)
POST /api/v1/notify/test           — fire a test message on one channel
GET  /api/v1/notify/preferences    — current user's channel preferences
POST /api/v1/notify/preferences    — update current user's channel preferences

All routes require X-API-Key (gateway check) via ``require_api_key``.
``/preferences`` additionally resolves the caller's JWT principal via
``current_principal`` so preferences are scoped per user.
"""
from __future__ import annotations

import json
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.auth import current_principal, Principal
from ..services import notify as notify_svc

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/notify",
    tags=["notify"],
    dependencies=[Depends(require_api_key)],
)

VALID_CHANNELS = {"email", "sms", "whatsapp"}

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class TestRequest(BaseModel):
    channel: Literal["email", "sms", "whatsapp"]
    to: str
    message: str


class PreferencesIn(BaseModel):
    channels: list[Literal["email", "sms", "whatsapp"]]
    email: Optional[str] = None
    phone: Optional[str] = None

    @field_validator("channels")
    @classmethod
    def non_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("channels must contain at least one entry")
        return v


class PreferencesOut(BaseModel):
    user_sub: str
    channels: list[str]
    email: Optional[str] = None
    phone: Optional[str] = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/health")
def health():
    """Return which providers are configured (no credentials leaked)."""
    return notify_svc.provider_status()


@router.post("/test")
async def test_send(body: TestRequest):
    """Fire a test notification on a single channel.

    Useful for verifying SMTP / Twilio configuration in staging.
    ``to`` must be a valid address for the chosen channel (email address or
    E.164 phone number for SMS/WhatsApp).
    """
    provider = notify_svc._providers.get(body.channel)
    if provider is None:
        raise HTTPException(400, f"Unknown channel: {body.channel}")

    result = await provider.send(
        to=body.to,
        subject="[DMS Test Notification]",
        body=body.message,
    )
    return result


@router.get("/preferences", response_model=PreferencesOut)
def get_preferences(
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Return the authenticated user's notification channel preferences."""
    from ..models import UserNotificationPreference

    pref = (
        db.query(UserNotificationPreference)
        .filter(UserNotificationPreference.user_sub == p.sub)
        .first()
    )
    if pref is None:
        return PreferencesOut(user_sub=p.sub, channels=["email"])

    channels = ["email"]
    if pref.notification_channels:
        try:
            channels = json.loads(pref.notification_channels)
        except Exception:
            channels = ["email"]

    return PreferencesOut(
        user_sub=p.sub,
        channels=channels,
        email=pref.email,
        phone=pref.phone,
    )


@router.post("/preferences", response_model=PreferencesOut)
def set_preferences(
    body: PreferencesIn,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Create or replace the authenticated user's notification channel preferences."""
    from ..models import UserNotificationPreference
    from datetime import datetime

    pref = (
        db.query(UserNotificationPreference)
        .filter(UserNotificationPreference.user_sub == p.sub)
        .first()
    )
    if pref is None:
        pref = UserNotificationPreference(user_sub=p.sub)
        db.add(pref)

    pref.notification_channels = json.dumps(body.channels)
    if body.email is not None:
        pref.email = body.email
    if body.phone is not None:
        pref.phone = body.phone
    pref.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(pref)

    return PreferencesOut(
        user_sub=p.sub,
        channels=body.channels,
        email=pref.email,
        phone=pref.phone,
    )

"""FIDO2 passwordless sign-in for customers.

Reuses the challenge pattern from services/webauthn_svc.py but stores credentials
per customer_cid (not per staff user). A successful assertion mints a short-lived
portal token, identical in shape to what portal.py's OTP flow returns — so every
downstream portal endpoint keeps working unchanged.

Flow:
  1. POST /api/v1/passkeys/register/start   {customer_cid}
  2. navigator.credentials.create(...) →
     POST /api/v1/passkeys/register/finish  {credential}

  1. POST /api/v1/passkeys/login/start      {customer_cid}
  2. navigator.credentials.get(...) →
     POST /api/v1/passkeys/login/finish     {credential}
     → returns {portal_token, expires_in_sec}
"""
from __future__ import annotations
import os
import secrets
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..models import PasskeyCredential, PortalSession
from .webauthn_svc import _lib, RP_ID, RP_NAME, ORIGIN, CHALLENGE_TTL_MIN


PORTAL_TOKEN_TTL_MIN = int(os.environ.get("PASSKEY_PORTAL_TTL", "60"))


def _user_handle(customer_cid: str) -> str:
    # Deterministic 32-byte handle so the authenticator can discover credentials
    # when the user types the CID on a new device.
    import hashlib
    return hashlib.sha256(f"nbe|{customer_cid}".encode()).hexdigest()[:32]


# In-memory nonce store (for simplicity — fall back to DB in prod replicas).
_CHALLENGES: dict[tuple[str, str], tuple[str, datetime]] = {}


def _put(kind: str, cid: str, nonce: str) -> None:
    _CHALLENGES[(kind, cid)] = (nonce, datetime.utcnow() + timedelta(minutes=CHALLENGE_TTL_MIN))


def _pop(kind: str, cid: str) -> str | None:
    k = (kind, cid)
    v = _CHALLENGES.get(k)
    if not v:
        return None
    nonce, exp = v
    if exp < datetime.utcnow():
        _CHALLENGES.pop(k, None)
        return None
    _CHALLENGES.pop(k, None)
    return nonce


def register_start(customer_cid: str) -> dict[str, Any]:
    challenge = secrets.token_urlsafe(32)
    _put("register", customer_cid, challenge)
    wa = _lib()
    handle = _user_handle(customer_cid)
    if wa:
        opts = wa.generate_registration_options(
            rp_id=RP_ID, rp_name=RP_NAME,
            user_id=handle.encode(), user_name=customer_cid,
            user_display_name=customer_cid,
            authenticator_selection=wa.AuthenticatorSelectionCriteria(
                resident_key=wa.ResidentKeyRequirement.REQUIRED,
                user_verification=wa.UserVerificationRequirement.REQUIRED,
            ),
        )
        opts.challenge = challenge.encode()
        return wa.options_to_json(opts)
    return {
        "challenge": challenge,
        "rp": {"id": RP_ID, "name": RP_NAME},
        "user": {"id": handle, "name": customer_cid, "displayName": customer_cid},
        "pubKeyCredParams": [{"type": "public-key", "alg": -7},
                             {"type": "public-key", "alg": -257}],
        "authenticatorSelection": {"residentKey": "required", "userVerification": "required"},
        "timeout": CHALLENGE_TTL_MIN * 60 * 1000,
    }


def register_finish(db: Session, customer_cid: str, credential: dict,
                    friendly_name: str | None = None) -> dict:
    nonce = _pop("register", customer_cid)
    if not nonce:
        raise ValueError("no_active_challenge")

    wa = _lib()
    handle = _user_handle(customer_cid)
    cred_id = credential.get("id", "")
    public_key = ""
    aaguid = ""

    if wa:
        try:
            v = wa.verify_registration_response(
                credential=credential,
                expected_challenge=nonce.encode(),
                expected_rp_id=RP_ID,
                expected_origin=ORIGIN,
            )
            cred_id = getattr(v, "credential_id", b"").hex() if hasattr(v, "credential_id") else cred_id
            public_key = getattr(v, "credential_public_key", b"").hex() if hasattr(v, "credential_public_key") else ""
            aaguid = getattr(v, "aaguid", "") or ""
        except Exception as e:
            raise ValueError(f"attestation_failed:{e}")

    row = PasskeyCredential(
        customer_cid=customer_cid, user_handle=handle,
        credential_id=cred_id, public_key=public_key,
        aaguid=str(aaguid)[:64], friendly_name=friendly_name or "Passkey",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"credential_db_id": row.id, "customer_cid": customer_cid}


def login_start(db: Session, customer_cid: str) -> dict[str, Any]:
    challenge = secrets.token_urlsafe(32)
    _put("login", customer_cid, challenge)
    creds = db.query(PasskeyCredential).filter(
        PasskeyCredential.customer_cid == customer_cid).all()
    return {
        "challenge": challenge,
        "rpId": RP_ID,
        "allowCredentials": [{"type": "public-key", "id": c.credential_id}
                             for c in creds if c.credential_id],
        "userVerification": "required",
        "timeout": CHALLENGE_TTL_MIN * 60 * 1000,
    }


def login_finish(db: Session, customer_cid: str, credential: dict) -> dict:
    nonce = _pop("login", customer_cid)
    if not nonce:
        raise ValueError("no_active_challenge")

    cred_row = db.query(PasskeyCredential).filter(
        PasskeyCredential.customer_cid == customer_cid,
        PasskeyCredential.credential_id == credential.get("id", ""),
    ).first()
    if not cred_row:
        raise ValueError("unknown_credential")

    wa = _lib()
    if wa:
        try:
            v = wa.verify_authentication_response(
                credential=credential,
                expected_challenge=nonce.encode(),
                expected_rp_id=RP_ID,
                expected_origin=ORIGIN,
                credential_public_key=bytes.fromhex(cred_row.public_key or ""),
                credential_current_sign_count=cred_row.sign_count or 0,
            )
            cred_row.sign_count = getattr(v, "new_sign_count", cred_row.sign_count)
        except Exception as e:
            raise ValueError(f"assertion_failed:{e}")

    cred_row.last_used_at = datetime.utcnow()

    # Mint a portal session token — reuses the existing portal RBAC path.
    session = PortalSession(
        customer_cid=customer_cid,
        email=f"{customer_cid.lower()}@passkey.local",
        otp_code="",  # not used for passkey sessions
        otp_expires_at=datetime.utcnow(),
        token=secrets.token_urlsafe(32),
        verified_at=datetime.utcnow(),
    )
    db.add(session)
    db.commit()
    return {"portal_token": session.token,
            "expires_in_sec": PORTAL_TOKEN_TTL_MIN * 60,
            "customer_cid": customer_cid}

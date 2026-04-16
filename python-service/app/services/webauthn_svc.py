"""WebAuthn / passkey step-up for high-risk actions.

Flow:
  1. Client calls POST /api/v1/stepup/register/start → server returns PublicKeyCredentialCreationOptions
  2. Browser navigator.credentials.create(…) → client posts attestation back
  3. Server validates, stores credential_id + public_key for the user
  4. Before a high-risk action (fraud high/critical or loan over threshold):
        POST /api/v1/stepup/authenticate/start {action, resource_id}
     → PublicKeyCredentialRequestOptions
  5. Browser navigator.credentials.get(…) → posts assertion → server verifies
     + marks the challenge as used. The business endpoint checks
     `has_valid_stepup(user, action, resource_id)` before executing.

Uses the `webauthn` package when available. Falls back to a lightweight
challenge-only flow (still prevents replay, but skips cryptographic attestation)
for demo environments.
"""
from __future__ import annotations
import os
import secrets
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..models import WebAuthnCredential, StepUpChallenge


RP_ID = os.environ.get("WEBAUTHN_RP_ID", "dms.nbe.local")
RP_NAME = os.environ.get("WEBAUTHN_RP_NAME", "NBE DMS")
ORIGIN = os.environ.get("WEBAUTHN_ORIGIN", "https://dms.nbe.local")
CHALLENGE_TTL_MIN = 5


def _lib():
    try:
        import webauthn
        return webauthn
    except Exception:
        return None


def _new_challenge(db: Session, user_sub: str, action: str,
                   resource_id: int | None, kind: str) -> str:
    code = secrets.token_urlsafe(32)
    ch = StepUpChallenge(
        user_sub=user_sub, action=action, resource_id=resource_id or 0,
        challenge=code, kind=kind,
        expires_at=datetime.utcnow() + timedelta(minutes=CHALLENGE_TTL_MIN),
    )
    db.add(ch)
    db.commit()
    return code


def start_registration(db: Session, user_sub: str) -> dict[str, Any]:
    challenge = _new_challenge(db, user_sub, "register", None, "register")
    wa = _lib()
    if wa:
        opts = wa.generate_registration_options(
            rp_id=RP_ID, rp_name=RP_NAME,
            user_id=user_sub.encode(), user_name=user_sub,
            user_display_name=user_sub,
        )
        # py_webauthn has its own challenge — overwrite with ours so we track replay.
        opts.challenge = challenge.encode()
        return wa.options_to_json(opts)  # dict
    # Fallback — minimal shape for the browser API.
    return {
        "challenge": challenge,
        "rp": {"id": RP_ID, "name": RP_NAME},
        "user": {"id": user_sub, "name": user_sub, "displayName": user_sub},
        "pubKeyCredParams": [{"type": "public-key", "alg": -7}],
        "timeout": CHALLENGE_TTL_MIN * 60 * 1000,
        "attestation": "none",
    }


def finish_registration(db: Session, user_sub: str, credential: dict) -> dict:
    """`credential` is the JSON from navigator.credentials.create() (AttestationResponse)."""
    ch = (
        db.query(StepUpChallenge)
        .filter(StepUpChallenge.user_sub == user_sub,
                StepUpChallenge.kind == "register",
                StepUpChallenge.used == 0,
                StepUpChallenge.expires_at >= datetime.utcnow())
        .order_by(StepUpChallenge.id.desc())
        .first()
    )
    if not ch:
        raise ValueError("No active registration challenge")

    wa = _lib()
    if wa:
        try:
            verification = wa.verify_registration_response(
                credential=credential,
                expected_challenge=ch.challenge.encode(),
                expected_rp_id=RP_ID,
                expected_origin=ORIGIN,
            )
            cred_id = wa.base64url_to_bytes.__self__ if False else None  # type: ignore
            # Store as base64url strings for portability.
            cred_row = WebAuthnCredential(
                user_sub=user_sub,
                credential_id=getattr(verification, "credential_id", "").hex() if hasattr(verification, "credential_id") else "",
                public_key=getattr(verification, "credential_public_key", b"").hex() if hasattr(verification, "credential_public_key") else "",
                sign_count=getattr(verification, "sign_count", 0),
            )
        except Exception as e:
            raise ValueError(f"Attestation failed: {e}")
    else:
        cred_row = WebAuthnCredential(
            user_sub=user_sub,
            credential_id=credential.get("id", ""),
            public_key=credential.get("response", {}).get("publicKey", ""),
            sign_count=0,
        )

    db.add(cred_row)
    ch.used = 1
    db.commit()
    return {"credential_db_id": cred_row.id, "user_sub": user_sub}


def start_authentication(db: Session, user_sub: str, action: str,
                         resource_id: int | None) -> dict[str, Any]:
    challenge = _new_challenge(db, user_sub, action, resource_id, "authenticate")
    creds = db.query(WebAuthnCredential).filter(WebAuthnCredential.user_sub == user_sub).all()
    allow = [{"type": "public-key", "id": c.credential_id} for c in creds if c.credential_id]
    return {
        "challenge": challenge,
        "rpId": RP_ID,
        "allowCredentials": allow,
        "timeout": CHALLENGE_TTL_MIN * 60 * 1000,
        "userVerification": "required",
    }


def finish_authentication(db: Session, user_sub: str, action: str,
                          resource_id: int | None, credential: dict) -> dict:
    ch = (
        db.query(StepUpChallenge)
        .filter(StepUpChallenge.user_sub == user_sub,
                StepUpChallenge.action == action,
                StepUpChallenge.resource_id == (resource_id or 0),
                StepUpChallenge.kind == "authenticate",
                StepUpChallenge.used == 0,
                StepUpChallenge.expires_at >= datetime.utcnow())
        .order_by(StepUpChallenge.id.desc())
        .first()
    )
    if not ch:
        raise ValueError("No active step-up challenge")

    wa = _lib()
    if wa:
        cred_row = (
            db.query(WebAuthnCredential)
            .filter(WebAuthnCredential.user_sub == user_sub,
                    WebAuthnCredential.credential_id == credential.get("id", ""))
            .first()
        )
        if not cred_row:
            raise ValueError("Unknown credential")
        try:
            verification = wa.verify_authentication_response(
                credential=credential,
                expected_challenge=ch.challenge.encode(),
                expected_rp_id=RP_ID,
                expected_origin=ORIGIN,
                credential_public_key=bytes.fromhex(cred_row.public_key or ""),
                credential_current_sign_count=cred_row.sign_count or 0,
            )
            cred_row.sign_count = getattr(verification, "new_sign_count", cred_row.sign_count)
            cred_row.last_used_at = datetime.utcnow()
        except Exception as e:
            raise ValueError(f"Assertion failed: {e}")

    ch.used = 1
    db.commit()
    return {"ok": True, "action": action, "resource_id": resource_id}


def has_valid_stepup(db: Session, user_sub: str, action: str,
                     resource_id: int | None, within_sec: int = 300) -> bool:
    """Confirm the caller stepped up recently for this exact (action, resource)."""
    cutoff = datetime.utcnow() - timedelta(seconds=within_sec)
    return db.query(StepUpChallenge).filter(
        StepUpChallenge.user_sub == user_sub,
        StepUpChallenge.action == action,
        StepUpChallenge.resource_id == (resource_id or 0),
        StepUpChallenge.kind == "authenticate",
        StepUpChallenge.used == 1,
        StepUpChallenge.created_at >= cutoff,
    ).first() is not None

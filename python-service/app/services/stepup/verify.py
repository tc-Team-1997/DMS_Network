"""Step-up assertion cryptographic verification — SOX-1 closure (Wave C).

The assertion_id supplied by Node is the challenge code stored in
``stepup_challenges.challenge`` when ``kind='authenticate'``.  The existing
``finish_authentication`` flow already marks the challenge ``used=1`` and
verifies the WebAuthn signature; this module provides a secondary verify path
used by Node BEFORE storing the assertion_id.

Verification contract
---------------------
Input:  assertion_id (the challenge string), user_id (user sub), action_context
Output: {verified, factor, verified_at, expires_at}  (200)
        {verified: False, reason}                     (401)

Security invariants
-------------------
1. The assertion_id must correspond to a StepUpChallenge row with kind='authenticate'
   and used=1 (meaning the browser already completed the WebAuthn ceremony via
   POST /api/v1/stepup/authenticate/finish).
2. The row must not be expired (created_at within 5-minute TTL).
3. The assertion_id must not appear in stepup_used_assertions (replay prevention).
4. The user_sub on the challenge row must match the supplied user_id.

On success, a row is inserted into stepup_used_assertions to mark the
assertion_id as consumed, preventing replay within the TTL window.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ...models import StepUpChallenge, StepupUsedAssertion

ASSERTION_TTL_SEC = 300  # 5-minute replay window


class VerifyResult:
    __slots__ = ("verified", "factor", "verified_at", "expires_at", "reason")

    def __init__(self, *, verified: bool, factor: str | None = None,
                 verified_at: datetime | None = None,
                 expires_at: datetime | None = None,
                 reason: str | None = None):
        self.verified = verified
        self.factor = factor
        self.verified_at = verified_at
        self.expires_at = expires_at
        self.reason = reason

    def to_dict(self) -> dict:
        if self.verified:
            return {
                "verified": True,
                "factor": self.factor or "webauthn",
                "verified_at": self.verified_at.isoformat() if self.verified_at else None,
                "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            }
        return {"verified": False, "reason": self.reason}


def verify_assertion(db: Session, assertion_id: str, user_id: str,
                     action_context: str | None = None,
                     tenant_id: str = "nbe") -> VerifyResult:
    """Validate a WebAuthn assertion_id and mark it consumed.

    Parameters
    ----------
    db:
        SQLAlchemy session.
    assertion_id:
        The challenge string that was stored by Node as the opaque assertion_id.
        This equals StepUpChallenge.challenge.
    user_id:
        The user sub (JWT sub claim) whose credential should be on record.
    action_context:
        Optional action tag for logging (not enforced — the challenge already
        encodes the action at registration time).
    tenant_id:
        Tenant isolation key stored in stepup_used_assertions.

    Returns
    -------
    VerifyResult
        verified=True on success, verified=False with reason on any failure.
    """
    # 1. Replay check — fast path before hitting challenge table.
    already_used = db.get(StepupUsedAssertion, assertion_id)
    if already_used is not None:
        return VerifyResult(verified=False, reason="replayed")

    # 2. Locate the completed challenge.
    now = datetime.utcnow()
    cutoff = now - timedelta(seconds=ASSERTION_TTL_SEC)

    ch = (
        db.query(StepUpChallenge)
        .filter(
            StepUpChallenge.challenge == assertion_id,
            StepUpChallenge.kind == "authenticate",
            StepUpChallenge.used == 1,          # must have been completed
            StepUpChallenge.created_at >= cutoff,
        )
        .order_by(StepUpChallenge.id.desc())
        .first()
    )

    if ch is None:
        return VerifyResult(verified=False, reason="unknown_or_expired")

    # 3. Owner check — the challenge must belong to the calling user.
    if ch.user_sub != user_id:
        return VerifyResult(verified=False, reason="user_mismatch")

    # 4. Mark consumed — insert into replay table atomically before returning.
    used_row = StepupUsedAssertion(
        assertion_id=assertion_id,
        user_sub=user_id,
        tenant_id=tenant_id,
        used_at=now,
    )
    db.add(used_row)
    db.commit()

    expires_at = ch.created_at + timedelta(seconds=ASSERTION_TTL_SEC)
    return VerifyResult(
        verified=True,
        factor="webauthn",
        verified_at=ch.created_at,
        expires_at=expires_at,
    )

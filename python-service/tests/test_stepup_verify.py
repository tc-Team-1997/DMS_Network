"""Tests for SOX-1 step-up assertion verification — Wave C closure.

Pure service-layer unit tests using an in-memory SQLite session.
No HTTP calls — these test the verification logic directly.

Coverage:
- Successful verification of a completed challenge
- Replay attack rejection (same assertion_id used twice)
- TTL expiry rejection (past 5-minute window)
- Unknown assertion_id rejection
- User mismatch rejection
- Incomplete challenge (used=0) rejection
- VerifyResult.to_dict() shape for both verified and unverified outcomes
- StepupUsedAssertion row persisted after successful verify
- Tenant isolation preserved in used-assertion row
"""
import os
import pytest
from datetime import datetime, timedelta

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test.db")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import StepUpChallenge, StepupUsedAssertion
from app.services.stepup.verify import verify_assertion, ASSERTION_TTL_SEC


# ---------------------------------------------------------------------------
# In-memory DB fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session(test_engine):
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


# ---------------------------------------------------------------------------
# Helper: insert a step-up challenge
# ---------------------------------------------------------------------------

def _make_challenge(db, user_sub: str, challenge: str, used: int = 1,
                    age_sec: int = 0, action: str = "approve_document") -> StepUpChallenge:
    created_at = datetime.utcnow() - timedelta(seconds=age_sec)
    expires_at = created_at + timedelta(minutes=5)
    ch = StepUpChallenge(
        user_sub=user_sub,
        action=action,
        resource_id=0,
        challenge=challenge,
        kind="authenticate",
        used=used,
        expires_at=expires_at,
        created_at=created_at,
    )
    db.add(ch)
    db.commit()
    return ch


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestVerifyAssertionService:

    def test_success(self, db_session):
        _make_challenge(db_session, "user-alpha", "alpha-challenge-001")
        result = verify_assertion(db_session, "alpha-challenge-001", "user-alpha")
        assert result.verified is True
        assert result.factor == "webauthn"
        assert result.verified_at is not None
        assert result.expires_at is not None

    def test_replay_rejected(self, db_session):
        _make_challenge(db_session, "user-beta", "beta-challenge-001")
        r1 = verify_assertion(db_session, "beta-challenge-001", "user-beta")
        assert r1.verified is True
        # Second call — replay attack.
        r2 = verify_assertion(db_session, "beta-challenge-001", "user-beta")
        assert r2.verified is False
        assert r2.reason == "replayed"

    def test_unknown_assertion_rejected(self, db_session):
        result = verify_assertion(db_session, "nonexistent-assertion-xyz", "user-gamma")
        assert result.verified is False
        assert result.reason == "unknown_or_expired"

    def test_expired_ttl_rejected(self, db_session):
        # Challenge was created beyond the 5-minute replay window.
        _make_challenge(db_session, "user-delta", "delta-challenge-001",
                        age_sec=ASSERTION_TTL_SEC + 10)
        result = verify_assertion(db_session, "delta-challenge-001", "user-delta")
        assert result.verified is False
        assert result.reason == "unknown_or_expired"

    def test_user_mismatch_rejected(self, db_session):
        _make_challenge(db_session, "user-epsilon", "epsilon-challenge-001")
        # Attempt to use another user's challenge (forged user_id).
        result = verify_assertion(db_session, "epsilon-challenge-001", "user-zeta")
        assert result.verified is False
        assert result.reason == "user_mismatch"

    def test_incomplete_challenge_rejected(self, db_session):
        """Challenge exists but has not been completed (used=0)."""
        _make_challenge(db_session, "user-eta", "eta-challenge-001", used=0)
        result = verify_assertion(db_session, "eta-challenge-001", "user-eta")
        assert result.verified is False
        assert result.reason == "unknown_or_expired"

    def test_to_dict_verified_shape(self, db_session):
        _make_challenge(db_session, "user-theta", "theta-challenge-001")
        result = verify_assertion(db_session, "theta-challenge-001", "user-theta")
        d = result.to_dict()
        assert d["verified"] is True
        assert "factor" in d
        assert "verified_at" in d
        assert "expires_at" in d
        assert "reason" not in d

    def test_to_dict_unverified_shape(self, db_session):
        result = verify_assertion(db_session, "no-such-challenge", "user-iota")
        d = result.to_dict()
        assert d["verified"] is False
        assert "reason" in d

    def test_used_assertion_row_persisted(self, db_session):
        """Consuming a challenge inserts a StepupUsedAssertion row."""
        _make_challenge(db_session, "user-kappa", "kappa-challenge-001")
        result = verify_assertion(db_session, "kappa-challenge-001", "user-kappa")
        assert result.verified is True
        used = db_session.get(StepupUsedAssertion, "kappa-challenge-001")
        assert used is not None
        assert used.user_sub == "user-kappa"

    def test_tenant_id_stored_in_used_row(self, db_session):
        _make_challenge(db_session, "user-lambda", "lambda-challenge-001")
        verify_assertion(db_session, "lambda-challenge-001", "user-lambda",
                         tenant_id="custom-tenant")
        used = db_session.get(StepupUsedAssertion, "lambda-challenge-001")
        assert used is not None
        assert used.tenant_id == "custom-tenant"

    def test_expires_at_is_created_at_plus_ttl(self, db_session):
        """expires_at on the result equals challenge.created_at + ASSERTION_TTL_SEC."""
        _make_challenge(db_session, "user-mu", "mu-challenge-001")
        result = verify_assertion(db_session, "mu-challenge-001", "user-mu")
        assert result.verified is True
        # expires_at should be approximately now + 5 min (within a 1s window).
        expected = datetime.utcnow() + timedelta(seconds=ASSERTION_TTL_SEC)
        diff = abs((result.expires_at - expected).total_seconds())
        assert diff < 2, f"expires_at drift too large: {diff}s"

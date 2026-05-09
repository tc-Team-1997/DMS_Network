"""Tests for python-service/app/services/tenant_config/service.py.

Covers:
  1. get() roundtrip (set then get returns the same value).
  2. get_namespace() roundtrip.
  3. Schema validation rejection (branding namespace, bad primary_color).
  4. Hash chain integrity: 3 sequential writes → each row's hash equals
     sha256( (prev_hash or '') + canonical_json(row_dict) ).
  5. Reason length guard (< 20 chars → ValueError).
  6. get() returns default when key is absent.

All tests run against an in-memory SQLite DB so they have no side-effects.
"""
import hashlib
import json
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Ensure we run with a fresh in-memory DB — must be set before app imports.
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.models import Base, Tenant  # noqa: E402
from app.services.tenant_config.service import (  # noqa: E402
    _canonical_json,
    _compute_hash,
    get,
    get_namespace,
    set as set_config,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def engine():
    """Fresh in-memory SQLite engine per test — guarantees no inter-test bleed.

    set_config() calls db.commit() internally, so session-level rollback cannot
    undo committed writes. A fresh engine per test is the cleanest isolation.
    """
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine):
    """Session bound to the per-test engine; always closed on teardown."""
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()

    # Ensure the tenant row exists (FK required by tenant_config).
    session.add(Tenant(
        tenant_id="test-tenant",
        slug="test",
        display_name="Test Bank",
        regulator_name="Test Regulator",
        regulator_short="TR",
    ))
    session.commit()

    yield session

    session.close()


# ---------------------------------------------------------------------------
# 1. get() roundtrip
# ---------------------------------------------------------------------------

def test_get_roundtrip(db):
    set_config(
        db, "test-tenant", "branding", "monogram", "TB",
        actor_user_id=1,
        reason="Initial monogram setup for Test Bank onboarding flow",
    )
    result = get(db, "test-tenant", "branding", "monogram")
    assert result == "TB"


# ---------------------------------------------------------------------------
# 2. get_namespace() roundtrip
# ---------------------------------------------------------------------------

def test_get_namespace_roundtrip(db):
    set_config(
        db, "test-tenant", "branding", "footer_text", "Test Bank © 2026",
        actor_user_id=1,
        reason="Setting footer text for regulatory compliance display",
    )
    set_config(
        db, "test-tenant", "branding", "login_banner", "Welcome to Test Bank",
        actor_user_id=1,
        reason="Setting login banner for regulatory compliance display",
    )
    ns = get_namespace(db, "test-tenant", "branding")
    assert ns.get("footer_text") == "Test Bank © 2026"
    assert ns.get("login_banner") == "Welcome to Test Bank"


# ---------------------------------------------------------------------------
# 3. Schema validation rejection
# ---------------------------------------------------------------------------

def test_schema_validation_rejects_bad_color(db):
    """primary_color key must match ^#[0-9a-fA-F]{6}$ per branding schema properties.

    The namespace schema's properties define per-key value schemas.  Setting
    key='primary_color' validates the value string against the pattern sub-schema.
    """
    with pytest.raises(ValueError, match="Validation error"):
        set_config(
            db, "test-tenant", "branding", "primary_color", "not-a-color",
            actor_user_id=1,
            reason="Attempting to set an invalid color value for branding test",
        )


def test_schema_validation_accepts_valid_color(db):
    """A well-formed hex color must pass validation."""
    set_config(
        db, "test-tenant", "branding", "primary_color", "#FF5500",
        actor_user_id=1,
        reason="Setting brand primary color for Test Bank UI theme test",
    )
    assert get(db, "test-tenant", "branding", "primary_color") == "#FF5500"


def test_schema_validation_rejects_unknown_key(db):
    """additionalProperties: false must reject keys not listed in the namespace schema."""
    with pytest.raises(ValueError, match="not allowed in namespace"):
        set_config(
            db, "test-tenant", "branding", "unknown_config_key", "oops",
            actor_user_id=1,
            reason="Attempting to set an unknown branding key to test rejection",
        )


# ---------------------------------------------------------------------------
# 4. Hash chain integrity: 3 sequential writes
# ---------------------------------------------------------------------------

def test_hash_chain_integrity(db):
    """Three sequential writes to a fresh key produce a valid hash chain.

    Uses a key name unique to this test to avoid bleeding with other tests
    that write to the same (tenant_id, namespace) in the module-scoped engine.
    """
    from app.models import TenantConfigHistory

    tid = "test-tenant"
    ns = "branding"
    key = "logo_path"  # used only in this test

    # Write 1
    set_config(db, tid, ns, key, "/img/logo-v1.png", actor_user_id=1,
               reason="Hash chain test write 1 for logo_path integrity check")
    # Write 2
    set_config(db, tid, ns, key, "/img/logo-v2.png", actor_user_id=1,
               reason="Hash chain test write 2 for logo_path integrity check")
    # Write 3
    set_config(db, tid, ns, key, "/img/logo-v3.png", actor_user_id=1,
               reason="Hash chain test write 3 for logo_path integrity check")

    rows = (
        db.query(TenantConfigHistory)
        .filter_by(tenant_id=tid, namespace=ns, key=key)
        .order_by(TenantConfigHistory.history_id.asc())
        .all()
    )
    assert len(rows) == 3, f"Expected exactly 3 history rows for key=logo_path, got {len(rows)}"

    prev_hash = None
    for row in rows:
        row_dict = {
            "changed_at": row.changed_at,
            "changed_by": row.changed_by,
            "key": row.key,
            "namespace": row.namespace,
            "reason": row.reason,
            "schema_version": row.schema_version,
            "tenant_id": row.tenant_id,
            "value": row.value,
        }
        expected_hash = _compute_hash(prev_hash, row_dict)
        assert row.hash == expected_hash, (
            f"Hash mismatch at history_id={row.history_id}: "
            f"stored={row.hash!r} expected={expected_hash!r}"
        )
        assert row.prev_hash == prev_hash
        prev_hash = row.hash


# ---------------------------------------------------------------------------
# 5. Reason length guard
# ---------------------------------------------------------------------------

def test_reason_too_short_raises(db):
    with pytest.raises(ValueError, match="reason must be at least 20 characters"):
        set_config(
            db, "test-tenant", "branding", "monogram", "XY",
            actor_user_id=1,
            reason="too short",
        )


def test_reason_exactly_20_chars_accepted(db):
    # "12345678901234567890" is exactly 20 chars.
    set_config(
        db, "test-tenant", "branding", "monogram", "TS",
        actor_user_id=1,
        reason="12345678901234567890",
    )
    assert get(db, "test-tenant", "branding", "monogram") == "TS"


# ---------------------------------------------------------------------------
# 6. get() returns default when key is absent
# ---------------------------------------------------------------------------

def test_get_returns_default_for_missing_key(db):
    result = get(db, "test-tenant", "branding", "nonexistent_key_xyz", default="FALLBACK")
    assert result == "FALLBACK"


def test_get_returns_none_default_for_missing_key(db):
    result = get(db, "test-tenant", "branding", "another_missing_key")
    assert result is None


# ---------------------------------------------------------------------------
# 7. canonical_json determinism
# ---------------------------------------------------------------------------

def test_canonical_json_key_order():
    """Keys must be sorted and whitespace-free — critical for hash determinism."""
    obj = {"z": 3, "a": 1, "m": 2}
    out = _canonical_json(obj)
    assert out == '{"a":1,"m":2,"z":3}'


def test_compute_hash_empty_prev():
    """First row in chain (prev_hash=None) uses empty string as prefix."""
    row = {"key": "x", "value": "y"}
    expected = hashlib.sha256((_canonical_json(row)).encode("utf-8")).hexdigest()
    assert _compute_hash(None, row) == expected


def test_compute_hash_with_prev():
    row = {"key": "x", "value": "y"}
    prev = "abc123"
    expected = hashlib.sha256((prev + _canonical_json(row)).encode("utf-8")).hexdigest()
    assert _compute_hash(prev, row) == expected

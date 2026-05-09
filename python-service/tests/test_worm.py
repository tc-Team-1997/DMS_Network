"""Tests for the WORM retention-lock feature (BHU-32).

Coverage:
  - Happy path: lock, unlock, status, verify-batch
  - RBAC denials (viewer cannot lock/unlock/verify)
  - Idempotent lock (double-lock returns 200 with existing state)
  - Idempotent unlock (double-unlock returns 200)
  - Feature flag off → 503
  - OS-not-supported error path (Windows simulated)
  - Tamper detection via verify_integrity
  - Missing-file path in verify_integrity
  - compute_sha256 correctness
  - apply_immutable_flag / release_immutable_flag OS dispatch
  - verify_all_locked summary counts
  - Tenant boundary: document from another tenant returns 404
  - Unlock reason validation (invalid enum)
  - Lock on missing file returns 500
"""
from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import unittest.mock as mock
from datetime import datetime, timedelta
from pathlib import Path

# Ensure the service root is on sys.path when running directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

# ---------------------------------------------------------------------------
# Environment setup (must happen before app import)
# ---------------------------------------------------------------------------

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test_worm.db")

# Enable the feature flag for tests.
os.environ["FF_WORM"] = "1"


# ---------------------------------------------------------------------------
# App / DB fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    from app.main import app
    from fastapi.testclient import TestClient
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(scope="module")
def db_session():
    """Provide a raw SQLAlchemy session for direct model manipulation."""
    from app.db import SessionLocal
    session = SessionLocal()
    yield session
    session.close()


HEADERS = {"X-API-Key": "test-key"}

# JWT token helpers — issue tokens for role assertions.
def _make_jwt(role: str, tenant: str = "default", sub: str = "tester") -> str:
    from app.services.auth import issue_token
    return issue_token(sub=sub, tenant=tenant, branch=None, roles=[role])


def _admin_headers(tenant: str = "default") -> dict:
    return {**HEADERS, "Authorization": f"Bearer {_make_jwt('doc_admin', tenant)}"}


def _viewer_headers(tenant: str = "default") -> dict:
    return {**HEADERS, "Authorization": f"Bearer {_make_jwt('viewer', tenant)}"}


# ---------------------------------------------------------------------------
# Helper: create a real temp file and a matching Document row
# ---------------------------------------------------------------------------

@pytest.fixture()
def locked_doc_env(db_session, tmp_path):
    """Create a real file + a Document row and yield (doc, file_path, db)."""
    from app.models import Document

    content = b"National Bank of Egypt - test WORM document"
    file_path = tmp_path / "test_worm_doc.pdf"
    file_path.write_bytes(content)
    sha256 = hashlib.sha256(content).hexdigest()

    doc = Document(
        filename=str(file_path.name),
        original_name="test_worm_doc.pdf",
        mime_type="application/pdf",
        size_bytes=len(content),
        sha256=sha256,
        tenant="default",
        status="captured",
    )
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    # Override STORAGE_DIR so the service finds our tmp file.
    with mock.patch("app.config.settings.STORAGE_DIR", str(tmp_path)):
        yield doc, file_path, db_session

    # Cleanup: ensure immutable flag is removed before tmp_path teardown.
    try:
        file_path.chmod(0o644)
    except Exception:
        pass
    db_session.delete(doc)
    db_session.commit()


# ===========================================================================
# 1. compute_sha256
# ===========================================================================

def test_compute_sha256_correct(tmp_path):
    from app.services.worm import compute_sha256

    content = b"hello worm"
    f = tmp_path / "test.bin"
    f.write_bytes(content)

    expected = hashlib.sha256(content).hexdigest()
    assert compute_sha256(f) == expected


# ===========================================================================
# 2. apply_immutable_flag / release_immutable_flag — OS dispatch
# ===========================================================================

def test_apply_flag_dispatches_correct_command(tmp_path):
    """apply_immutable_flag calls the OS-appropriate command."""
    from app.services import worm as worm_svc

    f = tmp_path / "flag_test.bin"
    f.write_bytes(b"data")

    with mock.patch("app.services.worm._SYSTEM", "Linux"), \
         mock.patch("subprocess.run") as mock_run:
        mock_run.return_value = mock.MagicMock(returncode=0)
        worm_svc.apply_immutable_flag(f)
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "chattr"
        assert "+i" in cmd


def test_apply_flag_macos_dispatch(tmp_path):
    from app.services import worm as worm_svc

    f = tmp_path / "flag_test_mac.bin"
    f.write_bytes(b"data")

    with mock.patch("app.services.worm._SYSTEM", "Darwin"), \
         mock.patch("subprocess.run") as mock_run:
        mock_run.return_value = mock.MagicMock(returncode=0)
        worm_svc.apply_immutable_flag(f)
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "chflags"
        assert "uchg" in cmd


def test_release_flag_linux(tmp_path):
    from app.services import worm as worm_svc

    f = tmp_path / "release_test.bin"
    f.write_bytes(b"data")

    with mock.patch("app.services.worm._SYSTEM", "Linux"), \
         mock.patch("subprocess.run") as mock_run:
        mock_run.return_value = mock.MagicMock(returncode=0)
        worm_svc.release_immutable_flag(f)
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "chattr"
        assert "-i" in cmd


# ===========================================================================
# 3. OS not supported (Windows)
# ===========================================================================

def test_apply_flag_windows_raises():
    from app.services import worm as worm_svc

    with mock.patch("app.services.worm._SYSTEM", "Windows"):
        with pytest.raises(RuntimeError, match="not supported"):
            worm_svc.apply_immutable_flag("/some/path")


def test_release_flag_windows_raises():
    from app.services import worm as worm_svc

    with mock.patch("app.services.worm._SYSTEM", "Windows"):
        with pytest.raises(RuntimeError, match="not supported"):
            worm_svc.release_immutable_flag("/some/path")


# ===========================================================================
# 4. verify_integrity — tamper detection
# ===========================================================================

def test_verify_integrity_detects_tamper(locked_doc_env):
    from app.services.worm import verify_integrity
    from app.models import Document

    doc, file_path, db = locked_doc_env

    # Simulate a lock record with a deliberately wrong baseline hash.
    doc.worm_locked_at = datetime.utcnow()
    doc.sha256_at_lock = "deadbeef" * 8  # 64-char wrong hash
    db.commit()

    with mock.patch("app.config.settings.STORAGE_DIR", str(file_path.parent)):
        result = verify_integrity(doc.id, db)

    assert result["tampered"] is True
    assert result["sha256_baseline"] == "deadbeef" * 8
    assert result["sha256_current"] is not None

    # Cleanup.
    doc.worm_locked_at = None
    doc.sha256_at_lock = None
    db.commit()


def test_verify_integrity_no_tamper(locked_doc_env):
    from app.services.worm import verify_integrity, compute_sha256
    from app.models import Document

    doc, file_path, db = locked_doc_env
    real_sha = compute_sha256(file_path)

    doc.worm_locked_at = datetime.utcnow()
    doc.sha256_at_lock = real_sha
    db.commit()

    with mock.patch("app.config.settings.STORAGE_DIR", str(file_path.parent)):
        result = verify_integrity(doc.id, db)

    assert result["tampered"] is False
    assert result["sha256_current"] == real_sha

    doc.worm_locked_at = None
    doc.sha256_at_lock = None
    db.commit()


def test_verify_integrity_file_missing(db_session, tmp_path):
    """verify_integrity sets file_missing=True when stored file does not exist."""
    from app.services.worm import verify_integrity
    from app.models import Document

    doc = Document(
        filename="ghost_file.pdf",
        original_name="ghost_file.pdf",
        mime_type="application/pdf",
        size_bytes=0,
        sha256="abc" * 21 + "d",
        tenant="default",
        status="captured",
        worm_locked_at=datetime.utcnow(),
        sha256_at_lock="abc" * 21 + "d",
    )
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    # Point STORAGE_DIR at an empty tmp dir so the file is "missing".
    with mock.patch("app.config.settings.STORAGE_DIR", str(tmp_path)):
        result = verify_integrity(doc.id, db_session)

    assert result["file_missing"] is True
    assert result["tampered"] is False

    db_session.delete(doc)
    db_session.commit()


# ===========================================================================
# 5. API — lock (happy path)
# ===========================================================================

def test_lock_happy_path(client, locked_doc_env):
    doc, file_path, db = locked_doc_env

    with mock.patch("app.config.settings.STORAGE_DIR", str(file_path.parent)), \
         mock.patch("app.services.worm.apply_immutable_flag"), \
         mock.patch("app.services.worm.compute_sha256", return_value="abc123" * 10 + "abcd"):

        resp = client.post(
            f"/api/v1/documents/{doc.id}/worm/lock",
            json={"unlock_after_days": 365, "reason": "retention_policy_applied"},
            headers=_admin_headers(),
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["document_id"] == doc.id
    assert body["status"] == "locked"
    assert "locked_at" in body
    assert "sha256_baseline" in body

    # Cleanup.
    from app.models import Document as DocModel
    row = db.query(DocModel).filter(DocModel.id == doc.id).first()
    if row:
        row.worm_locked_at = None
        row.sha256_at_lock = None
        row.worm_unlock_after = None
        db.commit()


# ===========================================================================
# 6. API — lock idempotent (already locked)
# ===========================================================================

def test_lock_idempotent(client, locked_doc_env):
    from app.models import Document as DocModel

    doc, file_path, db = locked_doc_env
    now = datetime.utcnow()

    # Pre-set lock state directly.
    row = db.query(DocModel).filter(DocModel.id == doc.id).first()
    row.worm_locked_at = now
    row.worm_unlock_after = now + timedelta(days=365)
    row.sha256_at_lock = "aaaa" * 16
    db.commit()

    with mock.patch("app.config.settings.STORAGE_DIR", str(file_path.parent)):
        resp = client.post(
            f"/api/v1/documents/{doc.id}/worm/lock",
            json={"unlock_after_days": 100, "reason": "retry"},
            headers=_admin_headers(),
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "locked"

    # Cleanup.
    row.worm_locked_at = None
    row.sha256_at_lock = None
    row.worm_unlock_after = None
    db.commit()


# ===========================================================================
# 7. API — unlock (happy path)
# ===========================================================================

def test_unlock_happy_path(client, locked_doc_env):
    from app.models import Document as DocModel

    doc, file_path, db = locked_doc_env
    now = datetime.utcnow()

    # Pre-set lock so we have something to unlock.
    row = db.query(DocModel).filter(DocModel.id == doc.id).first()
    row.worm_locked_at = now
    row.worm_unlock_after = now - timedelta(days=1)  # already past
    row.sha256_at_lock = "aabbcc" * 10 + "aabb"
    db.commit()

    with mock.patch("app.config.settings.STORAGE_DIR", str(file_path.parent)), \
         mock.patch("app.services.worm.release_immutable_flag"):

        resp = client.post(
            f"/api/v1/documents/{doc.id}/worm/unlock",
            json={"reason": "legal_hold_released", "approver_notes": "Case 42 closed"},
            headers=_admin_headers(),
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "unlocked"
    assert body["unlock_reason"] == "legal_hold_released"


# ===========================================================================
# 8. API — unlock idempotent (already unlocked)
# ===========================================================================

def test_unlock_idempotent(client, locked_doc_env):
    doc, file_path, db = locked_doc_env

    resp = client.post(
        f"/api/v1/documents/{doc.id}/worm/unlock",
        json={"reason": "error_correction", "approver_notes": ""},
        headers=_admin_headers(),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "unlocked"


# ===========================================================================
# 9. API — status (happy path, unlocked doc)
# ===========================================================================

def test_status_unlocked_doc(client, locked_doc_env):
    doc, file_path, db = locked_doc_env

    with mock.patch("app.config.settings.STORAGE_DIR", str(file_path.parent)):
        resp = client.get(
            f"/api/v1/documents/{doc.id}/worm/status",
            headers=_admin_headers(),
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["worm_locked"] is False
    assert body["tampered"] is False
    assert body["document_id"] == doc.id


# ===========================================================================
# 10. API — status accessible by viewer role
# ===========================================================================

def test_status_accessible_to_viewer(client, locked_doc_env):
    doc, file_path, db = locked_doc_env

    with mock.patch("app.config.settings.STORAGE_DIR", str(file_path.parent)):
        resp = client.get(
            f"/api/v1/documents/{doc.id}/worm/status",
            headers=_viewer_headers(),
        )

    assert resp.status_code == 200


# ===========================================================================
# 11. RBAC — viewer cannot lock
# ===========================================================================

def test_viewer_cannot_lock(client, locked_doc_env):
    doc, file_path, db = locked_doc_env

    resp = client.post(
        f"/api/v1/documents/{doc.id}/worm/lock",
        json={"unlock_after_days": 30, "reason": "test"},
        headers=_viewer_headers(),
    )
    assert resp.status_code == 403


# ===========================================================================
# 12. RBAC — viewer cannot unlock
# ===========================================================================

def test_viewer_cannot_unlock(client, locked_doc_env):
    doc, file_path, db = locked_doc_env

    resp = client.post(
        f"/api/v1/documents/{doc.id}/worm/unlock",
        json={"reason": "error_correction"},
        headers=_viewer_headers(),
    )
    assert resp.status_code == 403


# ===========================================================================
# 13. RBAC — viewer cannot trigger verify-batch
# ===========================================================================

def test_viewer_cannot_verify_batch(client):
    resp = client.post(
        "/api/v1/worm/verify-batch",
        headers=_viewer_headers(),
    )
    assert resp.status_code == 403


# ===========================================================================
# 14. Tenant boundary — document from another tenant returns 404
# ===========================================================================

def test_tenant_boundary_lock(client, locked_doc_env):
    doc, file_path, db = locked_doc_env

    # Use a token for a different tenant.
    other_headers = {**HEADERS, "Authorization": f"Bearer {_make_jwt('doc_admin', 'other-tenant')}"}

    resp = client.post(
        f"/api/v1/documents/{doc.id}/worm/lock",
        json={"unlock_after_days": 30, "reason": "test"},
        headers=other_headers,
    )
    assert resp.status_code == 404


# ===========================================================================
# 15. Unlock reason validation — invalid enum value rejected
# ===========================================================================

def test_unlock_invalid_reason(client, locked_doc_env):
    doc, file_path, db = locked_doc_env

    resp = client.post(
        f"/api/v1/documents/{doc.id}/worm/unlock",
        json={"reason": "not_a_valid_reason"},
        headers=_admin_headers(),
    )
    # Pydantic validation on the Literal field → 422.
    assert resp.status_code == 422


# ===========================================================================
# 16. Feature flag off → lock returns 503
# ===========================================================================

def test_feature_flag_off_lock(client, locked_doc_env):
    doc, file_path, db = locked_doc_env

    import app.routers.worm as worm_mod
    original = worm_mod._FF_WORM

    worm_mod._FF_WORM = False
    try:
        resp = client.post(
            f"/api/v1/documents/{doc.id}/worm/lock",
            json={"unlock_after_days": 30, "reason": "test"},
            headers=_admin_headers(),
        )
        assert resp.status_code == 503
    finally:
        worm_mod._FF_WORM = original


# ===========================================================================
# 17. Lock on missing file returns 500
# ===========================================================================

def test_lock_file_not_on_disk(client, db_session, tmp_path):
    from app.models import Document as DocModel

    doc = DocModel(
        filename="nonexistent_file.pdf",
        original_name="nonexistent_file.pdf",
        mime_type="application/pdf",
        size_bytes=0,
        sha256="00" * 32,
        tenant="default",
        status="captured",
    )
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    # STORAGE_DIR points at a dir where the file doesn't exist.
    with mock.patch("app.config.settings.STORAGE_DIR", str(tmp_path)):
        resp = client.post(
            f"/api/v1/documents/{doc.id}/worm/lock",
            json={"unlock_after_days": 30, "reason": "test"},
            headers=_admin_headers(),
        )

    # 409 because _resolve_file_path raises HTTPException 409 for missing file.
    assert resp.status_code in (409, 500)

    db_session.delete(doc)
    db_session.commit()


# ===========================================================================
# 18. verify-batch happy path
# ===========================================================================

def test_verify_batch_happy_path(client):
    with mock.patch("app.services.worm.verify_all_locked") as mock_verify:
        mock_verify.return_value = {
            "examined": 5,
            "ok": 5,
            "tampered": 0,
            "missing": 0,
            "ran_at": datetime.utcnow().isoformat() + "Z",
        }

        resp = client.post(
            "/api/v1/worm/verify-batch",
            headers=_admin_headers(),
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["examined"] == 5
    assert body["tampered"] == 0
    assert body["ok"] == 5

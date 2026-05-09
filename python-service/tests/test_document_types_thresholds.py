"""
Tests for the OCR confidence threshold tuning feature.

Covers:
  - PATCH /api/v1/document-types/{id}  (threshold update)
      happy path, floor >= high validation, floor < 0, floor > 1,
      high_confidence > 1, high_confidence < 0
  - POST  /api/v1/document-types/{id}/test-thresholds
      happy path, missing sample, sample belonging to a different doctype,
      schema belonging to a different tenant

All DB calls use an in-memory SQLite DB (via TestClient + DB override).
OCR / extraction are monkeypatched; no Tesseract/Poppler required.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ─── env before app import ───────────────────────────────────────────────────
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test_doctype_thresholds.db")

from app.main import app  # noqa: E402
from app.db import get_db  # noqa: E402
from app.services.auth import Principal, current_principal  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_API_KEY_HDR = {"X-API-Key": "test-key"}


# ---------------------------------------------------------------------------
# JWT helper — issue a real token so current_principal is satisfied
# ---------------------------------------------------------------------------

def _make_jwt(tenant: str = "test-tenant", role: str = "doc_admin") -> str:
    from app.services.auth import issue_token
    return issue_token(sub="test-user", tenant=tenant, branch="HQ", roles=[role])


def _auth_headers(tenant: str = "test-tenant", role: str = "doc_admin") -> Dict[str, str]:
    return {
        "X-API-Key": "test-key",
        "Authorization": f"Bearer {_make_jwt(tenant=tenant, role=role)}",
    }


# ---------------------------------------------------------------------------
# In-memory SQLite fixtures
# ---------------------------------------------------------------------------

import tempfile  # noqa: E402
from sqlalchemy import create_engine, text as sqltext  # noqa: E402
from sqlalchemy.orm import sessionmaker, Session  # noqa: E402

_SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS document_type_schemas (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    description          TEXT,
    fields_json          TEXT NOT NULL DEFAULT '[]',
    active               INTEGER DEFAULT 1,
    tenant_id            TEXT NOT NULL DEFAULT 'test-tenant',
    created_at           TEXT,
    updated_at           TEXT,
    schema_version       INTEGER DEFAULT 1,
    inference_status     TEXT DEFAULT 'manual',
    source_samples_count INTEGER DEFAULT 0,
    vector_index_version INTEGER DEFAULT 0,
    autofill_floor       REAL DEFAULT 0.4,
    high_confidence      REAL DEFAULT 0.7,
    tested_with_sample_id INTEGER
);
CREATE TABLE IF NOT EXISTS document_type_samples (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_id    INTEGER NOT NULL,
    filename     TEXT NOT NULL,
    sha256       TEXT NOT NULL,
    storage_key  TEXT NOT NULL,
    size         INTEGER DEFAULT 0,
    mime_type    TEXT DEFAULT '',
    ocr_text     TEXT,
    ocr_backend  TEXT,
    ocr_mean_confidence REAL,
    schema_version INTEGER DEFAULT 1,
    uploaded_by  TEXT,
    uploaded_at  TEXT,
    tenant_id    TEXT NOT NULL DEFAULT 'test-tenant',
    UNIQUE(schema_id, sha256)
);
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant        TEXT NOT NULL,
    actor         TEXT NOT NULL,
    action        TEXT NOT NULL,
    resource_type TEXT,
    resource_id   TEXT,
    detail        TEXT,
    created_at    TEXT
);
"""


@pytest.fixture(scope="function")
def client_with_db():
    """
    TestClient with get_db overridden to a file-backed SQLite session.

    We use a named temp file rather than sqlite:// (in-memory) because
    SQLite in-memory creates a new database per connection; a file-backed
    DB is shared across all connections from the same engine.
    """
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name

    db_url = f"sqlite:///{db_path}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})

    # Create tables once via a raw connection.
    with engine.connect() as conn:
        for stmt in _SCHEMA_DDL.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                conn.execute(sqltext(stmt))
        conn.commit()

    SessionFactory = sessionmaker(bind=engine, autoflush=True, autocommit=False)

    def _override_db():
        db = SessionFactory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_db

    # Seed a fresh session for the fixture consumer to use directly.
    seed_db = SessionFactory()

    yield TestClient(app), seed_db

    seed_db.close()
    app.dependency_overrides.pop(get_db, None)
    engine.dispose()
    try:
        os.unlink(db_path)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

def _seed_schema(
    db: Session,
    tenant_id: str = "test-tenant",
    autofill_floor: float = 0.4,
    high_confidence: float = 0.7,
) -> int:
    name = f"TestSchema_{uuid.uuid4().hex[:8]}"
    db.execute(
        sqltext(
            "INSERT INTO document_type_schemas "
            "(name, tenant_id, autofill_floor, high_confidence, fields_json) "
            "VALUES (:name, :tenant, :floor, :high, '[]')"
        ),
        {"name": name, "tenant": tenant_id, "floor": autofill_floor, "high": high_confidence},
    )
    db.commit()
    row = db.execute(
        sqltext("SELECT id FROM document_type_schemas WHERE name = :name"),
        {"name": name},
    ).first()
    return row[0]


def _seed_sample(db: Session, schema_id: int, tenant_id: str = "test-tenant") -> int:
    sha = uuid.uuid4().hex
    db.execute(
        sqltext(
            "INSERT INTO document_type_samples "
            "(schema_id, filename, sha256, storage_key, size, mime_type, tenant_id) "
            "VALUES (:sid, :fn, :sha, :key, 0, 'image/png', :tenant)"
        ),
        {
            "sid": schema_id,
            "fn": f"sample_{sha[:8]}.png",
            "sha": sha,
            "key": f"doctype_samples/{schema_id}/{sha}.png",
            "tenant": tenant_id,
        },
    )
    db.commit()
    row = db.execute(
        sqltext(
            "SELECT id FROM document_type_samples WHERE sha256 = :sha"
        ),
        {"sha": sha},
    ).first()
    return row[0]


# ---------------------------------------------------------------------------
# validate_thresholds unit tests (pure service layer, no HTTP)
# ---------------------------------------------------------------------------

class TestValidateThresholds:
    """Unit tests for app.services.document_types.validate_thresholds."""

    def _call(self, floor, high):
        from app.services.document_types import validate_thresholds
        validate_thresholds(floor, high)

    def test_happy_path(self):
        self._call(0.4, 0.7)  # no exception

    def test_floor_zero_high_one(self):
        self._call(0.0, 1.0)  # boundary — valid

    def test_floor_equals_high_raises(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            self._call(0.5, 0.5)
        detail = exc_info.value.detail
        assert detail["error"] == "validation_failed"
        assert "high_confidence" in detail["details"]

    def test_floor_greater_than_high_raises(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            self._call(0.8, 0.5)
        assert exc_info.value.detail["error"] == "validation_failed"

    def test_floor_below_zero_raises(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            self._call(-0.1, 0.7)
        detail = exc_info.value.detail
        assert "autofill_floor" in detail["details"]

    def test_floor_above_one_raises(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            self._call(1.1, 1.5)
        detail = exc_info.value.detail
        assert "autofill_floor" in detail["details"]

    def test_high_below_zero_raises(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            self._call(None, -0.1)
        assert "high_confidence" in exc_info.value.detail["details"]

    def test_high_above_one_raises(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            self._call(None, 1.01)
        assert "high_confidence" in exc_info.value.detail["details"]

    def test_none_floor_skips_floor_check(self):
        self._call(None, 0.7)  # only high is validated — no exception

    def test_none_high_skips_high_check(self):
        self._call(0.4, None)  # only floor is validated — no exception

    def test_both_none_is_noop(self):
        self._call(None, None)  # nothing to validate — no exception


# ---------------------------------------------------------------------------
# PATCH /api/v1/document-types/{id}
# ---------------------------------------------------------------------------

class TestPatchThresholds:

    def test_happy_path_updates_both_thresholds(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(),
            json={"autofill_floor": 0.5, "high_confidence": 0.8},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["autofill_floor"] == 0.5
        assert body["high_confidence"] == 0.8
        assert body["id"] == schema_id

    def test_partial_update_only_floor(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db, autofill_floor=0.3, high_confidence=0.8)

        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(),
            json={"autofill_floor": 0.35},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["autofill_floor"] == 0.35
        assert body["high_confidence"] == 0.8  # unchanged

    def test_validation_failure_floor_gte_high(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(),
            json={"autofill_floor": 0.7, "high_confidence": 0.5},
        )
        # Pydantic model_validator catches this at the request model level (422)
        # OR validate_thresholds raises 400 for merged values. Both are acceptable.
        assert r.status_code in (400, 422), r.text

    def test_floor_equal_high_rejected(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(),
            json={"autofill_floor": 0.6, "high_confidence": 0.6},
        )
        assert r.status_code in (400, 422), r.text

    def test_floor_below_zero_rejected(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(),
            json={"autofill_floor": -0.1, "high_confidence": 0.7},
        )
        assert r.status_code in (400, 422), r.text

    def test_floor_above_one_rejected(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(),
            json={"autofill_floor": 1.1, "high_confidence": 1.2},
        )
        assert r.status_code in (400, 422), r.text

    def test_high_above_one_rejected(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(),
            json={"autofill_floor": 0.4, "high_confidence": 1.1},
        )
        assert r.status_code in (400, 422), r.text

    def test_requires_doc_admin_role(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(role="viewer"),
            json={"autofill_floor": 0.5, "high_confidence": 0.8},
        )
        assert r.status_code == 403

    def test_requires_api_key(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        # No X-API-Key header
        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers={"Authorization": f"Bearer {_make_jwt()}"},
            json={"autofill_floor": 0.5, "high_confidence": 0.8},
        )
        assert r.status_code == 401

    def test_tenant_boundary_rejected(self, client_with_db):
        client, db = client_with_db
        # Schema seeded under "test-tenant"
        schema_id = _seed_schema(db, tenant_id="test-tenant")

        # Request comes from "other-tenant"
        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(tenant="other-tenant"),
            json={"autofill_floor": 0.5, "high_confidence": 0.8},
        )
        assert r.status_code == 404

    def test_nonexistent_schema_returns_404(self, client_with_db):
        client, db = client_with_db

        r = client.patch(
            "/api/v1/document-types/999999",
            headers=_auth_headers(),
            json={"autofill_floor": 0.5, "high_confidence": 0.8},
        )
        assert r.status_code == 404

    def test_audit_log_written_on_success(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(),
            json={"autofill_floor": 0.45, "high_confidence": 0.75},
        )

        log_row = db.execute(
            sqltext(
                "SELECT action, detail FROM audit_log "
                "WHERE resource_id = :rid AND action = 'DOCTYPE_THRESHOLDS_UPDATED'"
            ),
            {"rid": str(schema_id)},
        ).first()

        assert log_row is not None, "audit_log entry not written"
        detail = json.loads(log_row[1])
        assert detail["after"]["autofill_floor"] == 0.45
        assert detail["after"]["high_confidence"] == 0.75
        assert detail["before"]["autofill_floor"] == 0.4  # default
        assert detail["before"]["high_confidence"] == 0.7  # default

    def test_tested_with_sample_id_valid_reference(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)
        sample_id = _seed_sample(db, schema_id)

        r = client.patch(
            f"/api/v1/document-types/{schema_id}",
            headers=_auth_headers(),
            json={
                "autofill_floor": 0.5,
                "high_confidence": 0.8,
                "tested_with_sample_id": sample_id,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["tested_with_sample_id"] == sample_id

    def test_tested_with_sample_id_wrong_schema_rejected(self, client_with_db):
        client, db = client_with_db
        schema_id_a = _seed_schema(db)
        schema_id_b = _seed_schema(db)
        sample_in_b = _seed_sample(db, schema_id_b)

        r = client.patch(
            f"/api/v1/document-types/{schema_id_a}",
            headers=_auth_headers(),
            json={
                "autofill_floor": 0.5,
                "high_confidence": 0.8,
                "tested_with_sample_id": sample_in_b,
            },
        )
        assert r.status_code == 400
        detail = r.json()["detail"]
        assert detail["error"] == "validation_failed"
        assert "tested_with_sample_id" in detail["details"]


# ---------------------------------------------------------------------------
# POST /api/v1/document-types/{id}/test-thresholds
# ---------------------------------------------------------------------------

class TestTestThresholds:
    """POST /api/v1/document-types/{id}/test-thresholds"""

    def _stub_ocr_extract(self, monkeypatch):
        """
        Patch the lazy imports inside services/document_types.py so CI without
        Tesseract / Poppler still passes.
        """
        import app.services.document_types as dt_svc

        class _FakeOcrResult:
            full_text = "Invoice number 1234 amount 500.00"
            mean_confidence = 0.88
            backend = "tesseract"

        class _FakeField:
            def __init__(self, value=None, confidence=0.0):
                self.value = value
                self.confidence = confidence

        class _FakeExtraction:
            customer_cid      = _FakeField("N/A", 0.9)
            customer_name     = _FakeField("Test Co.", 0.85)
            doc_number        = _FakeField("INV-1234", 0.95)
            dob               = _FakeField(None, 0.0)
            issue_date        = _FakeField("2026-01-01", 0.8)
            expiry_date       = _FakeField(None, 0.0)
            issuing_authority = _FakeField(None, 0.0)
            address           = _FakeField(None, 0.0)
            extra_fields      = {}

        # Patch at module level inside the service — the function does
        # `from ..services.docbrain.ocr import ocr_document` lazily, so we
        # need to intercept the module itself.
        import app.services.docbrain.ocr as ocr_mod
        import app.services.docbrain.extract as ext_mod

        monkeypatch.setattr(
            ocr_mod, "ocr_document",
            lambda data, mime: _FakeOcrResult(),
            raising=False,
        )
        monkeypatch.setattr(
            ext_mod, "extract_entities",
            lambda text, **kw: _FakeExtraction(),
            raising=False,
        )

    def test_happy_path_returns_extracted_fields(self, client_with_db, monkeypatch, tmp_path):
        client, db = client_with_db
        self._stub_ocr_extract(monkeypatch)

        schema_id = _seed_schema(db, autofill_floor=0.4, high_confidence=0.7)
        sample_id = _seed_sample(db, schema_id)

        # Patch STORAGE_DIR so the service doesn't look for a real file
        # (cached ocr_text path is used when text is present; seed a text).
        db.execute(
            sqltext(
                "UPDATE document_type_samples SET ocr_text = :text WHERE id = :id"
            ),
            {"text": "Invoice number 1234 amount 500.00", "id": sample_id},
        )
        db.commit()

        r = client.post(
            f"/api/v1/document-types/{schema_id}/test-thresholds",
            headers=_auth_headers(),
            json={"sample_id": sample_id},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "extracted_fields" in body
        assert "at_floor" in body
        assert "at_high" in body
        assert body["schema_id"] == schema_id
        assert body["sample_id"] == sample_id
        assert body["autofill_floor"] == pytest.approx(0.4)
        assert body["high_confidence"] == pytest.approx(0.7)
        assert isinstance(body["extracted_fields"], list)

    def test_field_status_labels_correct(self, client_with_db, monkeypatch):
        """
        Fields with confidence >= autofill_floor are "auto_fill",
        fields with confidence < high_confidence are "skip".
        """
        client, db = client_with_db

        import app.services.docbrain.extract as ext_mod

        class _HighConfField:
            value = "ABC"
            confidence = 0.95  # >= 0.4 → auto_fill

        class _LowConfField:
            value = None
            confidence = 0.1   # < 0.4 → skip

        class _PartialExtraction:
            customer_cid      = _HighConfField()
            customer_name     = _LowConfField()
            doc_number        = _LowConfField()
            dob               = _LowConfField()
            issue_date        = _LowConfField()
            expiry_date       = _LowConfField()
            issuing_authority = _LowConfField()
            address           = _LowConfField()
            extra_fields      = {}

        monkeypatch.setattr(
            ext_mod, "extract_entities",
            lambda text, **kw: _PartialExtraction(),
            raising=False,
        )

        schema_id = _seed_schema(db, autofill_floor=0.4, high_confidence=0.7)
        sample_id = _seed_sample(db, schema_id)
        db.execute(
            sqltext("UPDATE document_type_samples SET ocr_text = 'test text' WHERE id = :id"),
            {"id": sample_id},
        )
        db.commit()

        r = client.post(
            f"/api/v1/document-types/{schema_id}/test-thresholds",
            headers=_auth_headers(),
            json={"sample_id": sample_id},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        fields = {f["field_name"]: f for f in body["extracted_fields"]}

        assert fields["customer_cid"]["status"] == "auto_fill"
        assert fields["customer_name"]["status"] == "skip"

    def test_missing_sample_returns_404(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        r = client.post(
            f"/api/v1/document-types/{schema_id}/test-thresholds",
            headers=_auth_headers(),
            json={"sample_id": 999999},
        )
        assert r.status_code == 404

    def test_sample_belonging_to_different_schema_rejected(self, client_with_db):
        client, db = client_with_db
        schema_a = _seed_schema(db)
        schema_b = _seed_schema(db)
        sample_in_b = _seed_sample(db, schema_b)

        r = client.post(
            f"/api/v1/document-types/{schema_a}/test-thresholds",
            headers=_auth_headers(),
            json={"sample_id": sample_in_b},
        )
        assert r.status_code == 404

    def test_schema_belonging_to_different_tenant_rejected(self, client_with_db):
        client, db = client_with_db
        # Schema seeded under "other-tenant"
        schema_id = _seed_schema(db, tenant_id="other-tenant")
        sample_id = _seed_sample(db, schema_id, tenant_id="other-tenant")

        # Requesting tenant is "test-tenant"
        r = client.post(
            f"/api/v1/document-types/{schema_id}/test-thresholds",
            headers=_auth_headers(tenant="test-tenant"),
            json={"sample_id": sample_id},
        )
        # Schema not found → 404
        assert r.status_code == 404

    def test_viewer_role_can_read(self, client_with_db):
        """doctype:read is open to viewer and above."""
        client, db = client_with_db
        schema_id = _seed_schema(db)
        sample_id = _seed_sample(db, schema_id)
        db.execute(
            sqltext("UPDATE document_type_samples SET ocr_text = 'x' WHERE id = :id"),
            {"id": sample_id},
        )
        db.commit()

        r = client.post(
            f"/api/v1/document-types/{schema_id}/test-thresholds",
            headers=_auth_headers(role="viewer"),
            json={"sample_id": sample_id},
        )
        # viewer can call this endpoint; 200 or 503 (if OCR unavailable) are both fine
        assert r.status_code in (200, 503), r.text

    def test_no_api_key_rejected(self, client_with_db):
        client, db = client_with_db
        schema_id = _seed_schema(db)

        r = client.post(
            f"/api/v1/document-types/{schema_id}/test-thresholds",
            headers={"Authorization": f"Bearer {_make_jwt()}"},
            json={"sample_id": 1},
        )
        assert r.status_code == 401

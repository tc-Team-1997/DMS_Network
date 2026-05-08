"""
Tests for python-service/app/routers/doctypes.py

All calls to docbrain-ai-engineer service functions
(infer_schema, embed_samples, nearest_schemas, check_tamper,
baseline_fingerprint) are replaced with monkeypatched stubs so CI
does not require those modules to be present.
"""
from __future__ import annotations

import base64
import hashlib
import os
import uuid

import pytest
from fastapi.testclient import TestClient

# ─── ensure env before app import ─────────────────────────────────────────
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test_doctypes.db")

from app.main import app  # noqa: E402

H = {"X-API-Key": "test-key"}
client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixtures — module-scoped stubs
# ---------------------------------------------------------------------------

_INFER_RESULT = {
    "name": "National ID",
    "description": "Egyptian national ID card",
    "fields": [{"key": "id_number", "label": "ID number", "type": "text", "required": True,
                "ai_extract_from": "doc_number", "seen_in_samples": 3, "total_samples": 3}],
    "confidence": 0.92,
    "total_samples": 3,
    "per_sample": [
        {"filename": "s1.png", "ocr_preview": "NATIONAL ID 12345",
         "ocr_backend": "tesseract", "ocr_mean_confidence": 88.0,
         "extracted_fields": {"id_number": "12345"}},
        {"filename": "s2.png", "ocr_preview": "NATIONAL ID 67890",
         "ocr_backend": "tesseract", "ocr_mean_confidence": 88.0,
         "extracted_fields": {"id_number": "67890"}},
        {"filename": "s3.png", "ocr_preview": "NATIONAL ID 11111",
         "ocr_backend": "tesseract", "ocr_mean_confidence": 88.0,
         "extracted_fields": {"id_number": "11111"}},
    ],
}

_NEAREST_RESULT = [
    {"schema_id": 1, "name": "National ID", "similarity": 0.95},
    {"schema_id": 2, "name": "Passport", "similarity": 0.71},
]

_TAMPER_REPORT = {"tampered": False, "score": 0.01, "detail": "ok"}


# ---------------------------------------------------------------------------
# Helper: tiny valid PNG (1×1 white pixel)
# ---------------------------------------------------------------------------

_TINY_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)
_TINY_PNG_B64 = base64.b64encode(_TINY_PNG_BYTES).decode()
_TINY_PNG_SHA256 = hashlib.sha256(_TINY_PNG_BYTES).hexdigest()


def _make_sample(filename: str = "s.png") -> dict:
    return {
        "bytes_b64": _TINY_PNG_B64,
        "mime_type": "image/png",
        "filename": filename,
        "sha256": hashlib.sha256(filename.encode()).hexdigest(),  # unique per name
    }


# ---------------------------------------------------------------------------
# Stub fixtures — patch the learner + tamper modules at the package level.
# We patch the module objects that the router imports lazily via _import_*.
# ---------------------------------------------------------------------------

class _FakeLearner:
    @staticmethod
    def infer_schema(samples):
        return _INFER_RESULT

    @staticmethod
    def embed_samples(schema_id, samples, remove_sha256=None):
        return len(samples)

    @staticmethod
    def nearest_schemas(text):
        return _NEAREST_RESULT


class _FakeTamper:
    @staticmethod
    def baseline_fingerprint(schema_id, samples):
        pass

    @staticmethod
    def check_tamper(schema_id, data, mime_type):
        return _TAMPER_REPORT


class _FakeOcrResult:
    full_text = "NATIONAL ID 12345"
    mean_confidence = 88.0
    backend = "tesseract"
    pages = []
    languages = ["eng"]


class _FakeExtraction:
    id_number = "12345"

    def as_prefill(self):
        return {"id_number": "12345"}


@pytest.fixture(autouse=True)
def stub_docbrain_services(monkeypatch):
    """
    Patch the lazy-import helpers in the router so they return our stubs
    instead of trying to import the not-yet-existing modules.
    Also patch ocr_document and extract_entities at the module level so the
    classify-one and reindex endpoints don't hit real Tesseract.
    """
    import app.routers.doctypes as dt_router  # noqa: PLC0415

    monkeypatch.setattr(dt_router, "_import_learner", lambda: _FakeLearner)
    monkeypatch.setattr(dt_router, "_import_tamper",  lambda: _FakeTamper)

    # Patch module-level references (set at import time in the router).
    monkeypatch.setattr(dt_router, "ocr_document",    lambda data, mime: _FakeOcrResult())
    monkeypatch.setattr(dt_router, "extract_entities", lambda text, schema_hint=None: _FakeExtraction())


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestInfer:
    """POST /api/v1/docbrain/doctypes/infer"""

    def test_returns_proposed_schema(self):
        samples = [_make_sample(f"s{i}.png") for i in range(3)]
        r = client.post("/api/v1/docbrain/doctypes/infer", headers=H, json={"samples": samples})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "National ID"
        assert body["confidence"] == 0.92
        assert body["total_samples"] == 3
        assert "per_sample" in body
        assert len(body["per_sample"]) == 3

    def test_too_few_samples_rejected(self):
        # < 3 samples must fail validation
        samples = [_make_sample("s0.png"), _make_sample("s1.png")]
        r = client.post("/api/v1/docbrain/doctypes/infer", headers=H, json={"samples": samples})
        assert r.status_code == 422

    def test_requires_api_key(self):
        samples = [_make_sample(f"s{i}.png") for i in range(3)]
        r = client.post("/api/v1/docbrain/doctypes/infer", json={"samples": samples})
        assert r.status_code == 401


class TestCommit:
    """POST /api/v1/docbrain/doctypes/commit"""

    def test_creates_schema_and_stores_samples(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.routers.doctypes.settings.STORAGE_DIR", str(tmp_path))

        unique_name = f"TestDocType_commit_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": unique_name,
            "description": "unit test",
            "fields": [{"name": "ref", "type": "string", "required": False}],
            "samples": [_make_sample("c1.png"), _make_sample("c2.png")],
            "inference_status": "draft",
        }
        r = client.post("/api/v1/docbrain/doctypes/commit", headers=H, json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "schema_id" in body
        assert body["schema_id"] > 0
        assert body["samples_saved"] == 2
        # embed_samples returns len(samples) — 2
        assert body["vectors_indexed"] == 2

    def test_idempotent_by_sha256(self, tmp_path, monkeypatch):
        """Re-committing the same samples does not duplicate them."""
        monkeypatch.setattr("app.routers.doctypes.settings.STORAGE_DIR", str(tmp_path))

        unique_name = f"TestDocType_idem_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": unique_name,
            "description": "idempotency test",
            "fields": [],
            "samples": [_make_sample("idem1.png")],
            "inference_status": "draft",
        }
        r1 = client.post("/api/v1/docbrain/doctypes/commit", headers=H, json=payload)
        assert r1.status_code == 200
        r2 = client.post("/api/v1/docbrain/doctypes/commit", headers=H, json=payload)
        assert r2.status_code == 200
        # Second commit: same sha256 → samples_saved == 0 (already exists)
        assert r2.json()["samples_saved"] == 0

    def test_embed_samples_called_once(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.routers.doctypes.settings.STORAGE_DIR", str(tmp_path))

        call_count = []

        class TrackingLearner(_FakeLearner):
            @staticmethod
            def embed_samples(schema_id, samples, remove_sha256=None):
                call_count.append(1)
                return len(samples)

        monkeypatch.setattr("app.routers.doctypes._import_learner", lambda: TrackingLearner)

        unique_name = f"TestDocType_embed_track_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": unique_name,
            "fields": [],
            "samples": [_make_sample("et1.png")],
            "inference_status": "draft",
        }
        r = client.post("/api/v1/docbrain/doctypes/commit", headers=H, json=payload)
        assert r.status_code == 200
        assert len(call_count) == 1


class TestListSamples:
    """GET /api/v1/docbrain/doctypes/{schema_id}/samples"""

    def _create_schema_with_sample(self, tmp_path, monkeypatch) -> int:
        monkeypatch.setattr("app.routers.doctypes.settings.STORAGE_DIR", str(tmp_path))
        unique_name = f"Schema_list_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": unique_name,
            "fields": [],
            "samples": [_make_sample("ls1.png")],
            "inference_status": "draft",
        }
        r = client.post("/api/v1/docbrain/doctypes/commit", headers=H, json=payload)
        assert r.status_code == 200
        return r.json()["schema_id"]

    def test_returns_list(self, tmp_path, monkeypatch):
        sid = self._create_schema_with_sample(tmp_path, monkeypatch)
        r = client.get(f"/api/v1/docbrain/doctypes/{sid}/samples", headers=H)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)
        assert len(body) >= 1
        first = body[0]
        # ocr_text must NOT be in list response
        assert "ocr_text" not in first
        assert "id" in first
        assert "filename" in first

    def test_empty_for_unknown_schema(self):
        r = client.get("/api/v1/docbrain/doctypes/999999/samples", headers=H)
        assert r.status_code == 200
        assert r.json() == []


class TestGetSample:
    """GET /api/v1/docbrain/doctypes/{schema_id}/samples/{sample_id}"""

    def test_not_found_returns_404(self):
        r = client.get("/api/v1/docbrain/doctypes/1/samples/999999", headers=H)
        assert r.status_code == 404

    def test_returns_sample_with_ocr_preview(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.routers.doctypes.settings.STORAGE_DIR", str(tmp_path))

        # Insert a sample via commit.
        payload = {
            "name": f"Schema_getsample_{uuid.uuid4().hex[:8]}",
            "fields": [],
            "samples": [_make_sample("gs1.png")],
            "inference_status": "draft",
        }
        r = client.post("/api/v1/docbrain/doctypes/commit", headers=H, json=payload)
        sid = r.json()["schema_id"]

        # Get the sample id.
        lst = client.get(f"/api/v1/docbrain/doctypes/{sid}/samples", headers=H).json()
        sample_id = lst[0]["id"]

        r2 = client.get(f"/api/v1/docbrain/doctypes/{sid}/samples/{sample_id}", headers=H)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert "ocr_text_preview" in body
        assert "thumbnail_data_url" in body  # may be None but key must exist


class TestDeleteSample:
    """DELETE /api/v1/docbrain/doctypes/{schema_id}/samples/{sample_id}"""

    def test_delete_removes_row_and_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.routers.doctypes.settings.STORAGE_DIR", str(tmp_path))

        payload = {
            "name": f"Schema_delete_{uuid.uuid4().hex[:8]}",
            "fields": [],
            "samples": [_make_sample("del1.png")],
            "inference_status": "draft",
        }
        r = client.post("/api/v1/docbrain/doctypes/commit", headers=H, json=payload)
        sid = r.json()["schema_id"]
        lst = client.get(f"/api/v1/docbrain/doctypes/{sid}/samples", headers=H).json()
        sample_id = lst[0]["id"]

        # Delete.
        dr = client.delete(f"/api/v1/docbrain/doctypes/{sid}/samples/{sample_id}", headers=H)
        assert dr.status_code == 200
        assert dr.json()["deleted"] is True

        # List should now be empty.
        lst2 = client.get(f"/api/v1/docbrain/doctypes/{sid}/samples", headers=H).json()
        assert all(s["id"] != sample_id for s in lst2)

    def test_delete_not_found_returns_404(self):
        r = client.delete("/api/v1/docbrain/doctypes/1/samples/999999", headers=H)
        assert r.status_code == 404


class TestClassifyOne:
    """POST /api/v1/docbrain/doctypes/classify-one"""

    def test_returns_valid_best_match_shape(self, monkeypatch):
        # ocr_document and extract_entities are already patched by autouse fixture.
        # nearest_schemas is via _FakeLearner.
        r = client.post(
            "/api/v1/docbrain/doctypes/classify-one",
            headers=H,
            json={"bytes_b64": _TINY_PNG_B64, "mime_type": "image/png"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "best_match" in body
        assert "alternatives" in body
        assert "extraction" in body
        assert "ocr" in body
        bm = body["best_match"]
        assert bm["schema_id"] == 1
        assert bm["name"] == "National ID"
        assert "similarity" in bm

    def test_alternatives_present(self):
        r = client.post(
            "/api/v1/docbrain/doctypes/classify-one",
            headers=H,
            json={"bytes_b64": _TINY_PNG_B64, "mime_type": "image/png"},
        )
        body = r.json()
        assert len(body["alternatives"]) == 1
        assert body["alternatives"][0]["name"] == "Passport"

    def test_requires_api_key(self):
        r = client.post(
            "/api/v1/docbrain/doctypes/classify-one",
            json={"bytes_b64": _TINY_PNG_B64, "mime_type": "image/png"},
        )
        assert r.status_code == 401


class TestTamperCheck:
    """POST /api/v1/docbrain/doctypes/{schema_id}/tamper-check"""

    def test_bytes_path_returns_report(self):
        r = client.post(
            "/api/v1/docbrain/doctypes/1/tamper-check",
            headers=H,
            json={"bytes_b64": _TINY_PNG_B64, "mime_type": "image/png"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tampered" in body
        assert body["tampered"] is False

    def test_missing_both_fields_returns_400(self):
        r = client.post(
            "/api/v1/docbrain/doctypes/1/tamper-check",
            headers=H,
            json={},
        )
        assert r.status_code == 400

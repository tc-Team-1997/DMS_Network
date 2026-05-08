"""
Tests for python-service/app/services/docbrain/doctype_learner.py

All Ollama / OCR / classify / extract calls are stubbed via monkeypatch.
No real daemon is required in CI.
"""
from __future__ import annotations

import math
import os
import sqlite3
import struct
import tempfile
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import numpy as np
import pytest

# Ensure env vars are set before any app import.
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test_learner.db")

# ---------------------------------------------------------------------------
# Minimal stubs
# ---------------------------------------------------------------------------

class _FakeOcrResult:
    def __init__(self, text="NATIONAL ID 12345 DOB 1990-01-01", conf=85.0):
        self.full_text = text
        self.mean_confidence = conf
        self.backend = "tesseract"
        self.pages = []
        self.languages = ["eng"]


class _FakeExtractedField:
    def __init__(self, value=None, confidence=0.0):
        self.value = value
        self.confidence = confidence


class _FakeExtractionResult:
    def __init__(self, cid="123456789", name="John Doe"):
        self.customer_cid      = _FakeExtractedField(cid, 0.95)
        self.customer_name     = _FakeExtractedField(name, 0.90)
        self.doc_number        = _FakeExtractedField("P1234567", 0.85)
        self.dob               = _FakeExtractedField("1990-01-15", 0.88)
        self.issue_date        = _FakeExtractedField("2020-03-01", 0.82)
        self.expiry_date       = _FakeExtractedField("2030-03-01", 0.80)
        self.issuing_authority = _FakeExtractedField("Ministry of Interior", 0.75)
        self.address           = _FakeExtractedField(None, 0.0)
        self.extra_fields      = {}

    def as_prefill(self):
        return {"customer_name": "John Doe"}


class _FakeClassResult:
    def __init__(self, doc_class="National ID", confidence=0.92):
        self.doc_class = doc_class
        self.confidence = confidence
        self.reasoning = "Looks like a national ID"
        self.alternative = None


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def learner_module(monkeypatch):
    """Import doctype_learner with all external deps stubbed."""
    import app.services.docbrain.doctype_learner as lm

    monkeypatch.setattr(lm, "ocr_document",        lambda data, mime: _FakeOcrResult(), raising=False)
    monkeypatch.setattr(lm, "classify_document",   lambda text: _FakeClassResult(), raising=False)
    monkeypatch.setattr(lm, "extract_entities",    lambda text: _FakeExtractionResult(), raising=False)

    # Stub embed_text to return a deterministic 768-dim vector.
    _dim = 768
    _vec = [0.1] * _dim

    monkeypatch.setattr(lm, "embed_text",  lambda text: _vec, raising=False)
    # Patch the nested imports inside embed_samples and infer_schema.
    import app.services.docbrain.embed as emb_mod
    monkeypatch.setattr(emb_mod, "embed_text", lambda text: _vec)

    # Patch the LLM chat_json call used in _discover_extra_fields.
    import app.services.docbrain.llm as llm_mod
    monkeypatch.setattr(llm_mod, "chat_json",
                        lambda sys, usr, **kw: {"extra_fields": []},
                        raising=False)

    # Patch within module to avoid real Ollama.
    def fake_chat_json(system, user, **kw):
        return {"extra_fields": []}

    monkeypatch.setattr(lm, "_discover_extra_fields",
                        lambda doc_class, combined, n, fn: [],
                        raising=False)

    return lm


@pytest.fixture()
def in_memory_db():
    """Provide a bare sqlite3 in-memory connection with the required tables."""
    conn = sqlite3.connect(":memory:", isolation_level=None)
    conn.execute("""
        CREATE TABLE document_type_schemas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'default'
        )
    """)
    conn.execute("""
        CREATE TABLE document_type_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            schema_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            storage_key TEXT,
            mime_type TEXT,
            ocr_text TEXT,
            UNIQUE(schema_id, sha256)
        )
    """)
    conn.execute("""
        CREATE TABLE doctype_sample_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sample_id INTEGER NOT NULL,
            chunk_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            embedding BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(sample_id, chunk_index)
        )
    """)
    yield conn
    conn.close()


def _insert_sample(conn, schema_id, sha256, ocr_text="sample text"):
    conn.execute(
        "INSERT OR IGNORE INTO document_type_samples "
        "(schema_id, filename, sha256, storage_key, mime_type, ocr_text) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (schema_id, "test.png", sha256, "key", "image/png", ocr_text),
    )
    row = conn.execute(
        "SELECT id FROM document_type_samples WHERE schema_id=? AND sha256=?",
        (schema_id, sha256),
    ).fetchone()
    return row[0]


# ---------------------------------------------------------------------------
# Tests: infer_schema
# ---------------------------------------------------------------------------

class TestInferSchema:

    def test_returns_valid_shape_with_3_samples(self, learner_module):
        """3 samples → InferredSchema with required fields."""
        lm = learner_module
        samples = [
            {"data": b"fake", "mime_type": "image/png", "filename": f"s{i}.png"}
            for i in range(3)
        ]
        # Patch ocr_document + classify + extract at module level inside the fn.
        import app.services.docbrain.ocr as ocr_mod
        import app.services.docbrain.classify as cls_mod
        import app.services.docbrain.extract as ext_mod
        import unittest.mock as mock

        with (
            mock.patch.object(ocr_mod, "ocr_document",      side_effect=lambda d, m: _FakeOcrResult()),
            mock.patch.object(cls_mod, "classify_document", side_effect=lambda t, **kw: _FakeClassResult()),
            mock.patch.object(ext_mod, "extract_entities",  side_effect=lambda t, **kw: _FakeExtractionResult()),
        ):
            result = lm.infer_schema(samples)

        assert "name" in result
        assert "per_sample" in result
        assert result["name"] == "National ID"
        assert 0.0 <= result["confidence"] <= 1.0
        assert isinstance(result["fields"], list)
        assert len(result["per_sample"]) == 3

    def test_required_flag_set_for_fields_seen_in_80_percent(self, learner_module):
        """Fields seen in all 3/3 samples (100%) must be required=True."""
        lm = learner_module
        samples = [
            {"data": b"fake", "mime_type": "image/png", "filename": f"s{i}.png"}
            for i in range(3)
        ]
        import app.services.docbrain.ocr as ocr_mod
        import app.services.docbrain.classify as cls_mod
        import app.services.docbrain.extract as ext_mod
        import unittest.mock as mock

        with (
            mock.patch.object(ocr_mod, "ocr_document",      side_effect=lambda d, m: _FakeOcrResult()),
            mock.patch.object(cls_mod, "classify_document", side_effect=lambda t, **kw: _FakeClassResult()),
            mock.patch.object(ext_mod, "extract_entities",  side_effect=lambda t, **kw: _FakeExtractionResult()),
        ):
            result = lm.infer_schema(samples)

        fields = {f["key"]: f for f in result["fields"]}
        # customer_cid and customer_name appear in all 3 samples → required=True.
        assert fields["customer_cid"]["required"] is True
        assert fields["customer_name"]["required"] is True

    def test_field_missing_in_minority_is_not_required(self, learner_module):
        """A field seen in only 1/3 samples (33%) must be required=False."""
        lm = learner_module

        import app.services.docbrain.ocr as ocr_mod
        import app.services.docbrain.classify as cls_mod
        import app.services.docbrain.extract as ext_mod
        import unittest.mock as mock

        call_count = [0]

        def variable_extract(text, **kw):
            call_count[0] += 1
            res = _FakeExtractionResult()
            # Only first sample has an address.
            if call_count[0] != 1:
                res.address = _FakeExtractedField(None, 0.0)
            else:
                res.address = _FakeExtractedField("123 Main St", 0.85)
            return res

        samples = [
            {"data": b"fake", "mime_type": "image/png", "filename": f"s{i}.png"}
            for i in range(3)
        ]

        with (
            mock.patch.object(ocr_mod, "ocr_document",      side_effect=lambda d, m: _FakeOcrResult()),
            mock.patch.object(cls_mod, "classify_document", side_effect=lambda t, **kw: _FakeClassResult()),
            mock.patch.object(ext_mod, "extract_entities",  side_effect=variable_extract),
        ):
            result = lm.infer_schema(samples)

        fields = {f["key"]: f for f in result["fields"]}
        if "address" in fields:
            assert fields["address"]["required"] is False

    def test_ai_extract_from_is_canonical_or_none(self, learner_module):
        """Every proposed field's ai_extract_from must be in canonical set or None."""
        from app.services.docbrain.doctype_learner import _CANONICAL_KEYS
        lm = learner_module
        samples = [
            {"data": b"fake", "mime_type": "image/png", "filename": f"s{i}.png"}
            for i in range(3)
        ]
        import app.services.docbrain.ocr as ocr_mod
        import app.services.docbrain.classify as cls_mod
        import app.services.docbrain.extract as ext_mod
        import unittest.mock as mock

        with (
            mock.patch.object(ocr_mod, "ocr_document",      side_effect=lambda d, m: _FakeOcrResult()),
            mock.patch.object(cls_mod, "classify_document", side_effect=lambda t, **kw: _FakeClassResult()),
            mock.patch.object(ext_mod, "extract_entities",  side_effect=lambda t, **kw: _FakeExtractionResult()),
        ):
            result = lm.infer_schema(samples)

        for f in result["fields"]:
            aef = f.get("ai_extract_from")
            assert aef is None or aef in _CANONICAL_KEYS, (
                f"Field {f['key']} has invalid ai_extract_from={aef!r}"
            )

    def test_per_sample_length_matches_input(self, learner_module):
        lm = learner_module
        n = 5
        samples = [
            {"data": b"fake", "mime_type": "image/png", "filename": f"s{i}.png"}
            for i in range(n)
        ]
        import app.services.docbrain.ocr as ocr_mod
        import app.services.docbrain.classify as cls_mod
        import app.services.docbrain.extract as ext_mod
        import unittest.mock as mock

        with (
            mock.patch.object(ocr_mod, "ocr_document",      side_effect=lambda d, m: _FakeOcrResult()),
            mock.patch.object(cls_mod, "classify_document", side_effect=lambda t, **kw: _FakeClassResult()),
            mock.patch.object(ext_mod, "extract_entities",  side_effect=lambda t, **kw: _FakeExtractionResult()),
        ):
            result = lm.infer_schema(samples)

        assert len(result["per_sample"]) == n


# ---------------------------------------------------------------------------
# Tests: embed_samples
# ---------------------------------------------------------------------------

class TestEmbedSamples:

    def test_writes_correct_chunk_count(self, in_memory_db):
        """ceil(len(text) / 450) chunks per sample (window=500, overlap=50 → step=450)."""
        import app.services.docbrain.doctype_learner as lm
        import app.services.docbrain.embed as emb_mod
        import unittest.mock as mock

        _dim = 768
        _vec = [0.01] * _dim

        schema_id = 42
        sha256 = "aabbcc001"
        # Use a text that produces a known chunk count.
        text = "A" * 1000   # step=450 → chunks at 0, 450, 900 → 3 chunks (trimmed: 500,500,100 chars)
        expected_chunks = math.ceil(1000 / 450)  # = 3 (ceil(2.22...))

        _insert_sample(in_memory_db, schema_id, sha256, text)

        with mock.patch.object(emb_mod, "embed_text", return_value=_vec):
            count = lm.embed_samples(
                schema_id,
                [{"data": b"", "mime_type": "image/png", "sha256": sha256, "ocr_text": text}],
                db=in_memory_db,
            )

        assert count == expected_chunks

    def test_idempotent_overwrite(self, in_memory_db):
        """Calling embed_samples twice on same sample replaces chunks, not appends."""
        import app.services.docbrain.doctype_learner as lm
        import app.services.docbrain.embed as emb_mod
        import unittest.mock as mock

        _dim = 768
        _vec = [0.01] * _dim
        schema_id = 43
        sha256 = "idem001"
        text = "B" * 500

        _insert_sample(in_memory_db, schema_id, sha256, text)

        with mock.patch.object(emb_mod, "embed_text", return_value=_vec):
            lm.embed_samples(
                schema_id,
                [{"data": b"", "mime_type": "image/png", "sha256": sha256, "ocr_text": text}],
                db=in_memory_db,
            )
            count2 = lm.embed_samples(
                schema_id,
                [{"data": b"", "mime_type": "image/png", "sha256": sha256, "ocr_text": text}],
                db=in_memory_db,
            )

        # Get actual row count.
        sample_id = in_memory_db.execute(
            "SELECT id FROM document_type_samples WHERE schema_id=? AND sha256=?",
            (schema_id, sha256),
        ).fetchone()[0]
        row_count = in_memory_db.execute(
            "SELECT COUNT(*) FROM doctype_sample_chunks WHERE sample_id=?",
            (sample_id,),
        ).fetchone()[0]

        expected = math.ceil(500 / 450)
        assert row_count == expected

    def test_remove_sha256_deletes_chunks(self, in_memory_db):
        """remove_sha256 kwarg deletes all chunks for that sha256's sample."""
        import app.services.docbrain.doctype_learner as lm
        import app.services.docbrain.embed as emb_mod
        import unittest.mock as mock

        _dim = 768
        _vec = [0.01] * _dim
        schema_id = 44
        sha256 = "del001"
        text = "C" * 500

        _insert_sample(in_memory_db, schema_id, sha256, text)

        sample_id = in_memory_db.execute(
            "SELECT id FROM document_type_samples WHERE schema_id=? AND sha256=?",
            (schema_id, sha256),
        ).fetchone()[0]

        # Write some chunks first.
        with mock.patch.object(emb_mod, "embed_text", return_value=_vec):
            lm.embed_samples(
                schema_id,
                [{"data": b"", "mime_type": "image/png", "sha256": sha256, "ocr_text": text}],
                db=in_memory_db,
            )

        pre = in_memory_db.execute(
            "SELECT COUNT(*) FROM doctype_sample_chunks WHERE sample_id=?",
            (sample_id,),
        ).fetchone()[0]
        assert pre > 0

        # Now delete via remove_sha256.
        lm.embed_samples(
            schema_id, [], db=in_memory_db, remove_sha256=sha256,
        )

        post = in_memory_db.execute(
            "SELECT COUNT(*) FROM doctype_sample_chunks WHERE sample_id=?",
            (sample_id,),
        ).fetchone()[0]
        assert post == 0


# ---------------------------------------------------------------------------
# Tests: nearest_schemas
# ---------------------------------------------------------------------------

class TestNearestSchemas:

    def _populate_chunks(self, conn, schema_id, schema_name, sha256, n_chunks=3):
        """Insert a schema, a sample, and n_chunks chunk rows with a fixed vector."""
        conn.execute(
            "INSERT OR IGNORE INTO document_type_schemas (id, name) VALUES (?, ?)",
            (schema_id, schema_name),
        )
        conn.execute(
            "INSERT OR IGNORE INTO document_type_samples "
            "(id, schema_id, filename, sha256, storage_key, mime_type) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (schema_id * 100, schema_id, "test.png", sha256, "key", "image/png"),
        )
        sample_id = schema_id * 100
        _dim = 768
        vec = [float(schema_id) / 10.0] * _dim    # distinct per schema
        blob = struct.pack(f"{_dim}f", *vec)
        for idx in range(n_chunks):
            conn.execute(
                "INSERT OR IGNORE INTO doctype_sample_chunks "
                "(sample_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?)",
                (sample_id, idx, f"chunk {idx}", blob),
            )

    def test_returns_top_k_sorted_by_similarity(self, in_memory_db, monkeypatch, tmp_path):
        """nearest_schemas returns at most top_k results sorted descending by similarity."""
        import app.services.docbrain.doctype_learner as lm
        import app.services.docbrain.embed as emb_mod
        import unittest.mock as mock

        _dim = 768

        # Insert two schemas.
        self._populate_chunks(in_memory_db, 1, "National ID", "sha_nid")
        self._populate_chunks(in_memory_db, 2, "Passport", "sha_pp")

        # Query vector = [0.1, ...] — closer to schema 1 (vec=[0.1,...]) than schema 2 (vec=[0.2,...]).
        query_vec = [0.1] * _dim

        # Monkeypatch embed_text and _get_fallback_db.
        with (
            mock.patch.object(emb_mod, "embed_text", return_value=query_vec),
            mock.patch.object(lm, "_fetch_all", wraps=lambda db, sql, params: (
                in_memory_db.execute(
                    "SELECT dsc.embedding, dts.schema_id, dts2.name "
                    "FROM doctype_sample_chunks dsc "
                    "JOIN document_type_samples dts ON dts.id = dsc.sample_id "
                    "JOIN document_type_schemas dts2 ON dts2.id = dts.schema_id"
                ).fetchall()
            )),
        ):
            results = lm.nearest_schemas("some document text about national id", top_k=2)

        assert len(results) <= 2
        # Results must be in descending similarity order.
        sims = [r["similarity"] for r in results]
        assert sims == sorted(sims, reverse=True)
        # Each result must have the required keys.
        for r in results:
            assert "schema_id" in r
            assert "name" in r
            assert "similarity" in r

    def test_empty_text_returns_empty(self, in_memory_db, monkeypatch):
        """Empty query text → empty list, no DB calls."""
        import app.services.docbrain.doctype_learner as lm

        results = lm.nearest_schemas("", top_k=3)
        assert results == []

    def test_no_chunks_returns_empty(self, in_memory_db, monkeypatch):
        """No rows in doctype_sample_chunks → empty list."""
        import app.services.docbrain.doctype_learner as lm
        import app.services.docbrain.embed as emb_mod
        import unittest.mock as mock

        _dim = 768
        query_vec = [0.1] * _dim

        with (
            mock.patch.object(emb_mod, "embed_text", return_value=query_vec),
            mock.patch.object(lm, "_fetch_all", return_value=[]),
        ):
            results = lm.nearest_schemas("some text", top_k=3)

        assert results == []


# ---------------------------------------------------------------------------
# Tests: _chunk_text (internal, verifies chunk-count invariant)
# ---------------------------------------------------------------------------

class TestChunkText:

    def test_chunk_count_matches_ceil_formula(self):
        from app.services.docbrain.doctype_learner import _chunk_text, _CHUNK_SIZE, _CHUNK_OVERLAP

        step = _CHUNK_SIZE - _CHUNK_OVERLAP  # 450
        text_len = 1000
        text = "X" * text_len
        chunks = _chunk_text(text)
        expected = math.ceil(text_len / step)
        assert len(chunks) == expected

    def test_empty_text_returns_empty_list(self):
        from app.services.docbrain.doctype_learner import _chunk_text
        assert _chunk_text("") == []
        assert _chunk_text("   ") == []

    def test_short_text_is_single_chunk(self):
        from app.services.docbrain.doctype_learner import _chunk_text
        chunks = _chunk_text("Hello world")
        assert len(chunks) == 1
        assert chunks[0] == "Hello world"

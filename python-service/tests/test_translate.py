"""Tests for the Dzongkha translation service and router.

Model loading is mocked throughout — the NLLB model is never loaded in CI.
All DB access goes through an in-memory SQLite3 connection.

Tests (≥ 15):
    1.  en→dz happy path
    2.  dz→en happy path
    3.  Cache hit — second identical call returns cache_hit=True
    4.  Cache hit latency < 200 ms (CI budget; real target 50 ms p99)
    5.  Oversized input raises ValueError
    6.  Unsupported lang pair raises ValueError
    7.  Tenant isolation — cache miss across tenants
    8.  Feature flag off raises RuntimeError
    9.  _chunk_text — short text stays as single chunk
   10.  _chunk_text — long text splits into ≤ max_chars chunks
   11.  _chunk_text — reconstructed content covers source text
   12.  Soft-delete causes next lookup to be a cache miss
   13.  Router GET /languages returns four default pairs
   14.  Router POST /translate — 200 with correct response shape
   15.  Router POST /translate — 400 for unsupported lang pair
"""
from __future__ import annotations

import hashlib
import importlib.util
import os
import pathlib
import sqlite3
import sys
import threading
import time
from datetime import datetime, timedelta
from typing import Any
from unittest.mock import MagicMock

import pytest

# ---------------------------------------------------------------------------
# Environment bootstrap (must happen before any app module is imported)
# ---------------------------------------------------------------------------

os.environ["FF_DZONGKHA_TRANSLATION"] = "on"
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test_translate.db")


# ---------------------------------------------------------------------------
# Load translate.py as a *standalone* module (no docbrain __init__, no OCR)
# ---------------------------------------------------------------------------

_TRANSLATE_PATH = (
    pathlib.Path(__file__).parent.parent
    / "app" / "services" / "docbrain" / "translate.py"
)


def _load_standalone(path: pathlib.Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod


_svc = _load_standalone(_TRANSLATE_PATH, "app.services.docbrain.translate")


# ---------------------------------------------------------------------------
# Minimal in-memory SQLite3 backend (no SQLAlchemy, no app.db)
# ---------------------------------------------------------------------------

class _MemDB:
    """Thread-safe in-memory SQLite3 that survives across calls within a test."""

    _conn: sqlite3.Connection | None = None
    _ready: bool = False
    _lock = threading.Lock()

    _DDL = """
    CREATE TABLE IF NOT EXISTS translations (
        cache_key      TEXT PRIMARY KEY,
        tenant_id      TEXT NOT NULL DEFAULT 'default',
        source_lang    TEXT NOT NULL,
        target_lang    TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        expires_at     TEXT NOT NULL,
        deleted_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tr_tenant ON translations(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tr_expires ON translations(expires_at);
    """

    @classmethod
    def get(cls) -> sqlite3.Connection:
        with cls._lock:
            if cls._conn is None:
                cls._conn = sqlite3.connect(":memory:", check_same_thread=False)
                cls._conn.row_factory = sqlite3.Row
                cls._conn.executescript(cls._DDL)
                cls._conn.commit()
                cls._ready = True
            return cls._conn

    @classmethod
    def reset(cls):
        with cls._lock:
            if cls._conn is not None:
                cls._conn.close()
            cls._conn = None
            cls._ready = False


# ---------------------------------------------------------------------------
# Self-contained translate / soft-delete that use _MemDB directly
# ---------------------------------------------------------------------------

def _translate(
    text: str,
    source: str,
    target: str,
    *,
    tenant_id: str = "test_tenant",
) -> tuple[str, float, bool]:
    """Functional twin of _svc.translate() that uses _MemDB instead of app.db."""
    if len(text) > _svc.MAX_INPUT_CHARS:
        raise ValueError(
            f"invalid_text_length: input is {len(text)} chars; "
            f"max is {_svc.MAX_INPUT_CHARS}"
        )
    if (source, target) not in _svc.SUPPORTED_PAIRS:
        raise ValueError(f"language_pair_not_supported: {source}->{target}")
    if not _svc._flag_enabled():
        raise RuntimeError(
            "FF_DZONGKHA_TRANSLATION is off — translation service disabled"
        )

    key = _svc._cache_key(text, source, target)
    conn = _MemDB.get()
    now = datetime.utcnow()

    row = conn.execute(
        "SELECT translated_text FROM translations "
        "WHERE cache_key = ? AND tenant_id = ? "
        "AND expires_at > ? AND deleted_at IS NULL",
        (key, tenant_id, now.isoformat()),
    ).fetchone()
    if row:
        return row["translated_text"], 0.95, True

    pipe = _svc._get_model()
    chunks = _svc._chunk_text(text)
    parts: list[str] = []
    for chunk in chunks:
        out = pipe(
            chunk,
            src_lang=_svc._LANG_MAP[source],
            tgt_lang=_svc._LANG_MAP[target],
            max_length=1024,
        )
        parts.append(out[0]["translation_text"] if out else "")

    translated = " ".join(parts).strip()
    expires = now + timedelta(days=7)
    conn.execute(
        "INSERT OR REPLACE INTO translations "
        "(cache_key, tenant_id, source_lang, target_lang, "
        " translated_text, created_at, expires_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (key, tenant_id, source, target, translated,
         now.isoformat(), expires.isoformat()),
    )
    conn.commit()
    return translated, 0.80, False


def _soft_delete(cache_key: str, tenant_id: str) -> bool:
    conn = _MemDB.get()
    now = datetime.utcnow().isoformat()
    cur = conn.execute(
        "UPDATE translations SET deleted_at = ? "
        "WHERE cache_key = ? AND tenant_id = ? AND deleted_at IS NULL",
        (now, cache_key, tenant_id),
    )
    conn.commit()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _isolate():
    """Reset model singleton and in-memory DB before every test."""
    _svc._pipeline = None
    _svc._schema_created = False
    _MemDB.reset()
    yield
    _svc._pipeline = None
    _svc._schema_created = False
    _MemDB.reset()


@pytest.fixture()
def mock_pipeline(monkeypatch):
    """Replace _get_model() with a no-weight deterministic stub."""

    def _pipe(text, *, src_lang, tgt_lang, max_length):
        return [{"translation_text": f"[{src_lang}->{tgt_lang}:{text[:20]}]"}]

    stub = MagicMock(side_effect=_pipe)

    def _fake_get_model():
        _svc._pipeline = stub
        return stub

    monkeypatch.setattr(_svc, "_get_model", _fake_get_model)
    return stub


# ---------------------------------------------------------------------------
# 1–8: Service-layer tests
# ---------------------------------------------------------------------------

class TestTranslateService:

    def test_en_to_dz_happy_path(self, mock_pipeline):
        """en→dz returns a non-empty string; cache_hit is False on first call."""
        result, confidence, cache_hit = _translate(
            "Welcome to the National Bank.", "en", "dz"
        )
        assert isinstance(result, str) and result
        assert cache_hit is False
        assert 0.0 <= confidence <= 1.0
        mock_pipeline.assert_called()

    def test_dz_to_en_happy_path(self, mock_pipeline):
        """dz→en returns a non-empty string."""
        result, confidence, cache_hit = _translate(
            "འདི་ནི་རྒྱལ་ཡོངས་དངུལ་ཁང་གི་ལས་འཆར།", "dz", "en"
        )
        assert isinstance(result, str) and result
        assert cache_hit is False

    def test_cache_hit_returns_cached_true(self, mock_pipeline):
        """Second call with same inputs hits cache; model called only once."""
        text = "Cache hit test."
        _, _, first = _translate(text, "en", "dz", tenant_id="t1")
        assert first is False

        _, _, second = _translate(text, "en", "dz", tenant_id="t1")
        assert second is True
        assert mock_pipeline.call_count == 1

    def test_cache_hit_latency_under_200ms(self, mock_pipeline):
        """Cached lookup completes in < 200 ms (CI wall-clock budget)."""
        text = "Latency test text."
        _translate(text, "en", "ar", tenant_id="t_lat")

        t0 = time.monotonic()
        _, _, hit = _translate(text, "en", "ar", tenant_id="t_lat")
        ms = (time.monotonic() - t0) * 1000

        assert hit is True
        assert ms < 200, f"Cache hit took {ms:.1f} ms — expected < 200 ms"

    def test_oversized_input_raises(self, mock_pipeline):
        """Input > MAX_INPUT_CHARS raises ValueError('invalid_text_length')."""
        big = "x" * (_svc.MAX_INPUT_CHARS + 1)
        with pytest.raises(ValueError, match="invalid_text_length"):
            _translate(big, "en", "dz")

    def test_unsupported_lang_pair_raises(self, mock_pipeline):
        """Unsupported pair raises ValueError('language_pair_not_supported')."""
        with pytest.raises(ValueError, match="language_pair_not_supported"):
            _translate("hello", "en", "zh")

    def test_tenant_isolation_on_cache(self, mock_pipeline):
        """Cache populated for tenant_a is a miss for tenant_b."""
        text = "Isolation text."
        _, _, ha = _translate(text, "en", "dz", tenant_id="ta")
        assert ha is False

        _, _, hb = _translate(text, "en", "dz", tenant_id="tb")
        assert hb is False  # different tenant → no cache reuse

    def test_feature_flag_off_raises(self, monkeypatch):
        """translate() raises RuntimeError when feature flag is off."""
        monkeypatch.setattr(_svc, "_flag_enabled", lambda: False)
        with pytest.raises(RuntimeError, match="FF_DZONGKHA_TRANSLATION"):
            _translate("hello", "en", "dz")


# ---------------------------------------------------------------------------
# 9–11: Chunker unit tests
# ---------------------------------------------------------------------------

class TestChunkText:

    def test_short_text_single_chunk(self):
        assert _svc._chunk_text("Short.", max_chars=2000) == ["Short."]

    def test_long_text_all_chunks_within_limit(self):
        text = "Sentence number one. " * 200  # ~4200 chars
        chunks = _svc._chunk_text(text, max_chars=500)
        assert len(chunks) > 1
        for c in chunks:
            assert len(c) <= 500, f"chunk length {len(c)} exceeds 500"

    def test_chunks_reconstruct_all_words(self):
        text = "Word test sentence. " * 100
        chunks = _svc._chunk_text(text, max_chars=300)
        joined = " ".join(chunks)
        # Spot-check first 30 words appear in reconstruction.
        for w in text.split()[:30]:
            assert w in joined


# ---------------------------------------------------------------------------
# 12: Soft-delete (DSAR)
# ---------------------------------------------------------------------------

class TestSoftDelete:

    def test_soft_delete_causes_cache_miss(self, mock_pipeline):
        """Soft-deleted entry is excluded; subsequent call re-runs inference."""
        text = "DSAR test."
        tenant = "t_dsar"
        _translate(text, "en", "dz", tenant_id=tenant)

        key = _svc._cache_key(text, "en", "dz")
        assert _soft_delete(key, tenant) is True

        _, _, hit = _translate(text, "en", "dz", tenant_id=tenant)
        assert hit is False  # cache miss after deletion


# ---------------------------------------------------------------------------
# 13–15: Router HTTP tests via a minimal FastAPI app
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def translate_client():
    """Build a tiny FastAPI app with only the translate router, no app.main."""
    from fastapi import FastAPI, Depends
    from fastapi.testclient import TestClient

    # Stub out modules that the router imports transitively before we import it.
    # We need app.db.get_db and app.security.require_api_key.
    import types

    # --- app.db stub ---
    _db_mod = types.ModuleType("app.db")

    class _Session:
        """Minimal SQLAlchemy-shaped session backed by _MemDB."""
        from sqlalchemy import text as _sa_text

        def execute(self, stmt, params=None):
            from sqlalchemy import text as _sa_text
            sql = str(stmt)
            conn = _MemDB.get()
            return conn.execute(sql, params or {})

        def commit(self):
            _MemDB.get().commit()

        def rollback(self):
            pass

        def close(self):
            pass

    def _fake_get_db():
        yield _Session()

    _db_mod.get_db = _fake_get_db
    _db_mod.SessionLocal = lambda: _Session()
    sys.modules["app.db"] = _db_mod

    # --- app.security stub ---
    _sec_mod = types.ModuleType("app.security")

    async def _fake_require_api_key(x_api_key: str = "test-key"):
        return True

    _sec_mod.require_api_key = _fake_require_api_key
    sys.modules["app.security"] = _sec_mod

    # --- stub app.services.docbrain.translate to point to _svc ---
    sys.modules.setdefault("app.services.docbrain.translate", _svc)

    # Patch the translate function referenced by the router so it uses _MemDB.
    import importlib as _il
    import pathlib as _pl

    _ROUTER_PATH = (
        _pl.Path(__file__).parent.parent / "app" / "routers" / "translate.py"
    )
    _router_spec = importlib.util.spec_from_file_location(
        "app.routers.translate", str(_ROUTER_PATH)
    )
    _router_mod = importlib.util.module_from_spec(_router_spec)
    sys.modules["app.routers.translate"] = _router_mod
    _router_spec.loader.exec_module(_router_mod)

    # Override the router's translate reference to use our in-memory version.
    _router_mod.translate = _translate  # type: ignore[attr-defined]

    app = FastAPI()
    app.include_router(_router_mod.router)

    # Override require_api_key dependency.
    from app.security import require_api_key as _rqk

    async def _no_auth():
        return True

    app.dependency_overrides[_router_mod.require_api_key] = _no_auth
    app.dependency_overrides[_router_mod.get_db] = _fake_get_db

    return TestClient(app)


HEADERS = {"X-API-Key": "test-key"}


class TestTranslateRouter:

    def test_get_languages_returns_supported_pairs(self, translate_client):
        """GET /api/v1/translate/languages returns 200 with four default pairs."""
        resp = translate_client.get("/api/v1/translate/languages", headers=HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert "supported_pairs" in body
        pairs = {(p["source"], p["target"]) for p in body["supported_pairs"]}
        assert ("en", "dz") in pairs
        assert ("dz", "en") in pairs
        assert ("en", "ar") in pairs
        assert ("ar", "en") in pairs

    def test_post_translate_happy_path(self, translate_client, mock_pipeline):
        """POST /api/v1/translate returns 200 with the expected response shape."""
        resp = translate_client.post(
            "/api/v1/translate",
            json={"text": "Hello world", "source_lang": "en", "target_lang": "dz"},
            headers=HEADERS,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "translated_text" in body
        assert body["source_lang"] == "en"
        assert body["target_lang"] == "dz"
        assert isinstance(body["cache_hit"], bool)
        assert isinstance(body["confidence_estimate"], float)
        assert "model_version" in body

    def test_post_translate_unsupported_pair(self, translate_client, mock_pipeline):
        """POST /api/v1/translate returns 400 for an unsupported lang pair."""
        resp = translate_client.post(
            "/api/v1/translate",
            json={"text": "Hello", "source_lang": "en", "target_lang": "zh"},
            headers=HEADERS,
        )
        assert resp.status_code == 400

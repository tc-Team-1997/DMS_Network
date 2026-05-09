"""Tests for the CC6 integration provider registry.

Covers:
  1. Default resolution: with no tenant_config row, get_provider() returns
     an OllamaOcr instance for kind='ocr'.
  2. Override resolution: writing integrations.llm.provider='aws' causes
     get_provider() to return a BedrockLlm instance, and calling .generate()
     on it raises NotImplementedError.
  3. Schema rejection: writing integrations.ocr.provider='gcp' raises
     ValueError (value not in enum).
  4. Cache invalidation: after writing a config change, the stale cached
     instance is evicted by invalidate() and the next call returns a fresh
     instance of the new class.
  5. Cache auto-invalidation: switching provider_name changes the cache key,
     so a fresh instance is returned without explicit invalidation.
  6. invalidate() calls reset() on the evicted instance.

All tests use an in-memory SQLite DB (no side-effects).
"""
from __future__ import annotations

import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Must be set before app imports.
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.models import Base  # noqa: E402
from app.services.tenant_config import set as set_config  # noqa: E402
from app.services.integrations import provider_registry  # noqa: E402
from app.services.integrations.provider_registry import (  # noqa: E402
    get_provider,
    invalidate,
    _INSTANCE_CACHE,
)
from app.services.integrations.providers.local import OllamaOcr  # noqa: E402
from app.services.integrations.providers_base import ProviderBase  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clear_registry_cache():
    """Ensure the module-level instance cache is empty before each test."""
    _INSTANCE_CACHE.clear()
    yield
    _INSTANCE_CACHE.clear()


@pytest.fixture
def engine():
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine):
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    yield session
    session.close()


# ---------------------------------------------------------------------------
# 1. Default resolution
# ---------------------------------------------------------------------------

def test_default_resolution_ocr(db):
    """With no tenant_config row, get_provider returns OllamaOcr for ocr."""
    provider = get_provider(db, "nbe", "ocr")
    assert isinstance(provider, OllamaOcr), (
        f"Expected OllamaOcr, got {type(provider).__name__}"
    )


def test_default_resolution_sms(db):
    """Default sms provider is NoopSms."""
    from app.services.integrations.providers.local import NoopSms
    provider = get_provider(db, "nbe", "sms")
    assert isinstance(provider, NoopSms)


def test_default_resolution_cache(db):
    """Default cache provider is LocalLruCache."""
    from app.services.integrations.providers.local import LocalLruCache
    provider = get_provider(db, "nbe", "cache")
    assert isinstance(provider, LocalLruCache)


# ---------------------------------------------------------------------------
# 2. Override resolution — AWS stub
# ---------------------------------------------------------------------------

def test_override_resolution_llm_aws(db):
    """Writing integrations.llm.provider='aws' resolves to BedrockLlm stub."""
    set_config(
        db, "nbe", "integrations", "llm.provider", "aws",
        actor_user_id=None,
        reason="cc6 test: switch llm to aws stub for testing",
    )

    provider = get_provider(db, "nbe", "llm")

    from app.services.integrations.providers.aws.aws_bedrock import BedrockLlm
    assert isinstance(provider, BedrockLlm), (
        f"Expected BedrockLlm, got {type(provider).__name__}"
    )


def test_aws_stub_raises_not_implemented(db):
    """Calling generate() on BedrockLlm raises NotImplementedError."""
    set_config(
        db, "nbe", "integrations", "llm.provider", "aws",
        actor_user_id=None,
        reason="cc6 test: switch llm to aws stub for not-impl check",
    )
    provider = get_provider(db, "nbe", "llm")

    with pytest.raises(NotImplementedError):
        provider.generate("hello world")


def test_aws_ocr_stub_raises(db):
    """TextractOcr.extract_text raises NotImplementedError."""
    set_config(
        db, "nbe", "integrations", "ocr.provider", "aws",
        actor_user_id=None,
        reason="cc6 test: switch ocr to aws textract stub",
    )
    provider = get_provider(db, "nbe", "ocr")

    from app.services.integrations.providers.aws.aws_textract import TextractOcr
    assert isinstance(provider, TextractOcr)

    with pytest.raises(NotImplementedError):
        provider.extract_text(b"fake", mime_type="image/png")


# ---------------------------------------------------------------------------
# 3. Schema rejection
# ---------------------------------------------------------------------------

def test_schema_rejects_unknown_provider(db):
    """Writing integrations.ocr.provider='gcp' raises ValueError (not in enum)."""
    with pytest.raises(ValueError, match="Validation error"):
        set_config(
            db, "nbe", "integrations", "ocr.provider", "gcp",
            actor_user_id=None,
            reason="cc6 test: attempting to set invalid provider name",
        )


def test_schema_rejects_unknown_key(db):
    """Writing an unknown key to integrations namespace raises ValueError."""
    with pytest.raises(ValueError):
        set_config(
            db, "nbe", "integrations", "nonexistent.key", "value",
            actor_user_id=None,
            reason="cc6 test: writing unknown key to integrations namespace",
        )


def test_schema_accepts_llm_model(db):
    """Writing integrations.llm.model is allowed by the schema."""
    set_config(
        db, "nbe", "integrations", "llm.model", "llama3:70b",
        actor_user_id=None,
        reason="cc6 test: set llm model to llama3 70b for production",
    )
    from app.services.tenant_config import get as cfg_get
    val = cfg_get(db, "nbe", "integrations", "llm.model")
    assert val == "llama3:70b"


# ---------------------------------------------------------------------------
# 4. Explicit cache invalidation
# ---------------------------------------------------------------------------

def test_invalidate_evicts_and_resets(db):
    """invalidate() removes the cached instance and calls reset() on it."""
    # Capture reset() calls via a flag on a fresh provider instance.
    provider_first = get_provider(db, "nbe", "cache")
    reset_called = []
    original_reset = provider_first.reset

    def _spy_reset():
        reset_called.append(True)
        original_reset()

    provider_first.reset = _spy_reset

    # Replace the cache entry with our spied instance.
    for k in list(_INSTANCE_CACHE.keys()):
        if k[0] == "nbe" and k[1] == "cache":
            _INSTANCE_CACHE[k] = provider_first

    evicted = invalidate("nbe", "cache")
    assert evicted == 1
    assert reset_called, "reset() was not called on the evicted instance"

    # Next call should produce a fresh instance (not the same object).
    provider_second = get_provider(db, "nbe", "cache")
    assert provider_second is not provider_first


def test_invalidate_unknown_kind_evicts_zero(db):
    """invalidate() on an unknown kind evicts 0 entries without error."""
    evicted = invalidate("nbe", "nonexistent_kind_xyz")
    assert evicted == 0


# ---------------------------------------------------------------------------
# 5. Auto-invalidation via cache key change
# ---------------------------------------------------------------------------

def test_switching_provider_returns_new_class(db):
    """Switching *.provider config produces a new class instance automatically."""
    # Seed default (ollama).
    provider_ollama = get_provider(db, "nbe", "llm")
    from app.services.integrations.providers.local import OllamaLlm
    assert isinstance(provider_ollama, OllamaLlm)

    # Switch to aws.
    set_config(
        db, "nbe", "integrations", "llm.provider", "aws",
        actor_user_id=None,
        reason="cc6 test: switch llm provider to aws for class change test",
    )

    # New get_provider call — different provider_name → different cache key → new instance.
    provider_aws = get_provider(db, "nbe", "llm")
    from app.services.integrations.providers.aws.aws_bedrock import BedrockLlm
    assert isinstance(provider_aws, BedrockLlm)
    assert provider_aws is not provider_ollama


# ---------------------------------------------------------------------------
# 6. Multiple tenants are isolated
# ---------------------------------------------------------------------------

def test_tenant_isolation(db):
    """Two tenants can have different providers for the same kind."""
    # nbe uses default (ollama).
    provider_nbe = get_provider(db, "nbe", "ocr")
    assert isinstance(provider_nbe, OllamaOcr)

    # bhutan switches to aws.
    set_config(
        db, "bhutan", "integrations", "ocr.provider", "aws",
        actor_user_id=None,
        reason="cc6 test: bhutan tenant switches ocr to aws textract stub",
    )
    provider_bhutan = get_provider(db, "bhutan", "ocr")
    from app.services.integrations.providers.aws.aws_textract import TextractOcr
    assert isinstance(provider_bhutan, TextractOcr)

    # nbe still resolves to ollama from cache.
    provider_nbe_again = get_provider(db, "nbe", "ocr")
    assert provider_nbe_again is provider_nbe


# ---------------------------------------------------------------------------
# 7. Local provider smoke tests (no external deps required)
# ---------------------------------------------------------------------------

def test_noop_sms_always_succeeds(db):
    """NoopSms.send() returns ok=True without any external call."""
    from app.services.integrations.providers.local import NoopSms
    provider = NoopSms()
    result = provider.send("+97517123456", "Test message from CC6 test suite")
    assert result.ok is True


def test_noop_cdn_url_format(db):
    """NoopCdn.public_url() returns /uploads/<key>."""
    from app.services.integrations.providers.local import NoopCdn
    provider = NoopCdn()
    url = provider.public_url("tenants/nbe/sha256/ab/cd/abcdef1234")
    assert url == "/uploads/tenants/nbe/sha256/ab/cd/abcdef1234"


def test_local_lru_cache_set_get_delete():
    """LocalLruCache basic round-trip."""
    from app.services.integrations.providers.local import LocalLruCache
    cache = LocalLruCache()
    cache.set("k1", b"hello", ttl_s=60)
    assert cache.get("k1") == b"hello"
    cache.delete("k1")
    assert cache.get("k1") is None


def test_local_lru_cache_ttl_expiry():
    """LocalLruCache returns None for expired entries."""
    import time
    from app.services.integrations.providers.local import LocalLruCache
    cache = LocalLruCache()
    # ttl_s=0 means expire_at is in the past immediately.
    cache.set("expired_key", b"data", ttl_s=0)
    # Tiny sleep to ensure monotonic clock advances past expire_at.
    time.sleep(0.01)
    assert cache.get("expired_key") is None


def test_local_lru_cache_max_entries():
    """LocalLruCache evicts oldest entries when capacity is exceeded."""
    from app.services.integrations.providers.local import LocalLruCache
    from app.services.integrations.providers.local.local_lru_cache import _MAX_ENTRIES
    cache = LocalLruCache()
    for i in range(_MAX_ENTRIES + 10):
        cache.set(f"key_{i}", b"v", ttl_s=300)
    # Total entries must not exceed _MAX_ENTRIES.
    assert len(cache._store) <= _MAX_ENTRIES


def test_ofac_watchlist_empty_when_no_file(db):
    """OfacJsonWatchlist.search() returns [] gracefully when the file is absent."""
    from app.services.integrations.providers.local import OfacJsonWatchlist
    provider = OfacJsonWatchlist(db=None, tenant_id="nbe")
    results = provider.search("Osama Bin Test")
    assert results == []


def test_ofac_watchlist_search_hits(tmp_path, db):
    """OfacJsonWatchlist.search() finds matching entries in a test JSON file."""
    import json
    watchlist_file = tmp_path / "ofac.json"
    watchlist_file.write_text(json.dumps([
        {
            "name": "John Badguy",
            "aliases": ["Johnny B", "JB"],
            "dob": "1970-01-01",
            "country": "US",
            "list_version": "OFAC-20240101",
            "list_id": "TEST-001",
        },
        {
            "name": "Completely Different Person",
            "aliases": [],
            "dob": None,
            "country": None,
            "list_version": "OFAC-20240101",
            "list_id": "TEST-002",
        },
    ]))

    from app.services.integrations.providers.local import OfacJsonWatchlist
    provider = OfacJsonWatchlist.__new__(OfacJsonWatchlist)
    provider._db = None
    provider._tenant_id = "nbe"

    # Patch _watchlist_path to return our test file.
    provider._watchlist_path = lambda: watchlist_file

    hits = provider.search("John Badguy")
    assert len(hits) >= 1
    assert hits[0].score >= 0.70
    assert hits[0].list_id == "TEST-001"

    # "Completely Different Person" should not match "John Badguy".
    for h in hits:
        assert h.list_id != "TEST-002"


def test_ofac_watchlist_list_versions(tmp_path):
    """OfacJsonWatchlist.list_versions() returns distinct versions."""
    import json
    watchlist_file = tmp_path / "ofac.json"
    watchlist_file.write_text(json.dumps([
        {"name": "Alice", "aliases": [], "dob": None, "country": None,
         "list_version": "v1", "list_id": "1"},
        {"name": "Bob", "aliases": [], "dob": None, "country": None,
         "list_version": "v2", "list_id": "2"},
        {"name": "Carol", "aliases": [], "dob": None, "country": None,
         "list_version": "v1", "list_id": "3"},
    ]))

    from app.services.integrations.providers.local import OfacJsonWatchlist
    provider = OfacJsonWatchlist.__new__(OfacJsonWatchlist)
    provider._db = None
    provider._tenant_id = "nbe"
    provider._watchlist_path = lambda: watchlist_file

    versions = provider.list_versions()
    version_strs = {v.version for v in versions}
    assert "v1" in version_strs
    assert "v2" in version_strs
    assert len(versions) == 2
    # v1 has 2 entries.
    v1 = next(v for v in versions if v.version == "v1")
    assert v1.entry_count == 2

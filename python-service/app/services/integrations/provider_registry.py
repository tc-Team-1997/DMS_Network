"""CC6 integration provider registry.

Resolves the active provider class for (tenant_id, kind) by reading
tenant_config namespace 'integrations' key '<kind>.provider'. Falls back
to DEFAULTS[kind] when no row is present.

Cache strategy
--------------
Resolved instances are cached in a module-level dict keyed by
(tenant_id, kind, provider_name). The key naturally invalidates when the
provider_name changes (e.g. ocr.provider: 'ollama' → 'aws') — the new
provider_name produces a cache miss and a fresh instance is constructed.

For config changes that do NOT change the provider class (e.g. llm.model
changes while llm.provider stays 'ollama'), explicit invalidation is needed:
call invalidate(tenant_id, kind). The registry calls reset() on the evicted
instance so it can release any held resources (connections, model handles).

Contract: provider implementations MUST re-read tenant_config on every call.
The registry caches the provider instance, not its config. Providers that
hold expensive resources MAY cache them but MUST expose a reset() method.

AWS stubs are imported lazily (inside _load_aws) to avoid pulling boto3
into the process at startup when AWS is not configured.
"""
from __future__ import annotations

import logging
from typing import TypeVar

from app.services.tenant_config import get as cfg_get
from .providers_base import (
    OcrProvider, EmbeddingProvider, LlmProvider, TranslateProvider,
    FaceMatchProvider, SmsProvider, EmailProvider, StorageProvider,
    KmsProvider, WatchlistProvider, BiProvider, CdnProvider, CacheProvider,
    ProviderBase,
)
from .providers.local import (
    OllamaOcr, LocalEmbedding, OllamaLlm, OllamaTranslate, LocalFaceMatch,
    LocalSmtp, NoopSms, LocalFsStorage, LocalKms, OfacJsonWatchlist,
    LocalParquetBi, NoopCdn, LocalLruCache,
)

log = logging.getLogger(__name__)

T = TypeVar("T", bound=ProviderBase)

# ---------------------------------------------------------------------------
# Default provider names per capability kind (seeded, local-first).
# ---------------------------------------------------------------------------

DEFAULTS: dict[str, str] = {
    "ocr":        "ollama",
    "embedding":  "local",
    "llm":        "ollama",
    "translate":  "ollama",
    "face_match": "local",
    "sms":        "noop",
    "email":      "local",
    "storage":    "local",
    "kms":        "local",
    "watchlist":  "ofac_json",
    "bi":         "local",
    "cdn":        "noop",
    "cache":      "local",
}

# ---------------------------------------------------------------------------
# Provider class map — (kind, provider_name) → class.
# AWS entries are callables that lazy-import and return the class so that
# boto3 is never imported at module load time.
# ---------------------------------------------------------------------------

def _aws(module: str, cls_name: str):
    """Lazy AWS class loader. Returns a zero-arg callable → class."""
    def _load():
        import importlib
        mod = importlib.import_module(
            f"app.services.integrations.providers.aws.{module}"
        )
        return getattr(mod, cls_name)
    return _load


PROVIDERS: dict[str, dict[str, type | object]] = {
    "ocr": {
        "ollama": OllamaOcr,
        "aws":    _aws("aws_textract", "TextractOcr"),
    },
    "embedding": {
        "local": LocalEmbedding,
        "aws":   _aws("aws_kendra", "KendraEmbedding"),
    },
    "llm": {
        "ollama": OllamaLlm,
        "aws":    _aws("aws_bedrock", "BedrockLlm"),
    },
    "translate": {
        "ollama": OllamaTranslate,
        "aws":    _aws("aws_translate", "AwsTranslate"),
    },
    "face_match": {
        "local": LocalFaceMatch,
        "aws":   _aws("aws_rekognition", "RekognitionFaceMatch"),
    },
    "sms": {
        "noop": NoopSms,
        "aws":  _aws("aws_sns", "SnsSms"),
    },
    "email": {
        "local": LocalSmtp,
        "aws":   _aws("aws_ses", "SesEmail"),
    },
    "storage": {
        "local": LocalFsStorage,
        "aws":   _aws("aws_s3", "S3Storage"),
    },
    "kms": {
        "local": LocalKms,
        "aws":   _aws("aws_kms", "AwsKms"),
    },
    "watchlist": {
        "ofac_json": OfacJsonWatchlist,
        "aws":       _aws("aws_macie", "MaciePiiDetector"),
    },
    "bi": {
        "local": LocalParquetBi,
        # No AWS equivalent; future CloudWatch/QuickSight adapter goes here.
    },
    "cdn": {
        "noop": NoopCdn,
        "aws":  _aws("aws_cloudfront", "CloudFrontCdn"),
    },
    "cache": {
        "local": LocalLruCache,
        "aws":   _aws("aws_elasticache", "ElastiCacheCache"),
    },
}

# ---------------------------------------------------------------------------
# Instance cache — keyed by (tenant_id, kind, provider_name).
# Must hold ProviderBase instances only.
# ---------------------------------------------------------------------------

_INSTANCE_CACHE: dict[tuple[str, str, str], ProviderBase] = {}


def _resolve_class(kind: str, provider_name: str) -> type:
    """Return the provider class for (kind, provider_name).

    Handles lazy AWS loaders (callables that are not types).
    """
    kind_map = PROVIDERS.get(kind)
    if kind_map is None:
        raise ValueError(f"Unknown capability kind {kind!r}. Known kinds: {sorted(PROVIDERS)}")

    entry = kind_map.get(provider_name)
    if entry is None:
        raise ValueError(
            f"Unknown provider {provider_name!r} for kind {kind!r}. "
            f"Available: {sorted(kind_map)}"
        )

    # Lazy AWS loader: a callable that is not itself a class.
    if callable(entry) and not isinstance(entry, type):
        cls = entry()   # calls _load() → returns the class
        # Replace the lazy loader with the resolved class for subsequent calls.
        kind_map[provider_name] = cls
        return cls

    return entry  # type: ignore[return-value]


def get_provider(db, tenant_id: str, kind: str) -> ProviderBase:
    """Resolve and return the active provider instance for (tenant_id, kind).

    Resolution order:
      1. Read tenant_config namespace='integrations' key='<kind>.provider'.
      2. Fall back to DEFAULTS[kind] if no config row exists.
      3. Look up the provider class in PROVIDERS[kind][provider_name].
      4. Return the cached instance if (tenant_id, kind, provider_name) is cached.
      5. Construct a new instance and cache it.

    The cache key includes provider_name so that switching
    '<kind>.provider' in tenant_config automatically produces a new instance
    on the next call without requiring explicit invalidation.

    Args:
        db:        SQLAlchemy Session — passed through to tenant_config.get().
        tenant_id: Tenant identifier string.
        kind:      Capability kind (e.g. 'ocr', 'llm', 'kms').

    Returns:
        A ProviderBase subclass instance ready to use.

    Raises:
        ValueError: if kind or provider_name is not registered.
    """
    provider_name: str = cfg_get(
        db, tenant_id, "integrations", f"{kind}.provider",
        default=DEFAULTS.get(kind, "")
    )
    if not provider_name:
        raise ValueError(
            f"No default provider configured for kind {kind!r} and "
            f"no tenant_config row found."
        )

    cache_key = (tenant_id, kind, provider_name)
    if cache_key in _INSTANCE_CACHE:
        return _INSTANCE_CACHE[cache_key]

    cls = _resolve_class(kind, provider_name)
    instance = cls()
    _INSTANCE_CACHE[cache_key] = instance
    log.debug(
        "provider_registry: resolved %s/%s/%s → %s",
        tenant_id, kind, provider_name, cls.__name__,
    )
    return instance


def invalidate(tenant_id: str, kind: str) -> int:
    """Evict cached provider instances for (tenant_id, kind).

    Calls reset() on each evicted instance so it can release held resources
    (SMTP connections, in-memory caches, model handles). Returns the number
    of entries evicted.

    This is needed when an INTERNAL config knob changes without changing the
    provider class (e.g. llm.model changes while llm.provider stays 'ollama').
    Switching *.provider keys causes automatic invalidation via the cache key.

    Args:
        tenant_id: Tenant to invalidate. Pass '*' to invalidate all tenants
                   for the given kind (admin-level reset).
        kind:      Capability kind to invalidate.

    Returns:
        Number of cache entries evicted.
    """
    to_evict = [
        k for k in _INSTANCE_CACHE
        if k[1] == kind and (tenant_id == "*" or k[0] == tenant_id)
    ]
    for k in to_evict:
        instance = _INSTANCE_CACHE.pop(k)
        try:
            instance.reset()
        except Exception as exc:
            log.warning("provider_registry: reset() failed for %s: %s", k, exc)
    if to_evict:
        log.info(
            "provider_registry: invalidated %d entry/entries for "
            "tenant=%r kind=%r", len(to_evict), tenant_id, kind,
        )
    return len(to_evict)


def invalidate_tenant(tenant_id: str) -> int:
    """Evict all cached providers for *tenant_id*. Returns entries evicted."""
    to_evict = [k for k in _INSTANCE_CACHE if k[0] == tenant_id]
    for k in to_evict:
        instance = _INSTANCE_CACHE.pop(k)
        try:
            instance.reset()
        except Exception as exc:
            log.warning("provider_registry: reset() failed for %s: %s", k, exc)
    return len(to_evict)

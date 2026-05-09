"""AWS ElastiCache (Redis) cache stub — registered but NOT enabled by default."""
from __future__ import annotations

from typing import Optional

from ...providers_base import CacheProvider

_MSG = (
    "AWS ElastiCache adapter is registered but not enabled. "
    "Set integrations.cache.provider='aws' in tenant_config and provide "
    "ELASTICACHE_ENDPOINT, ELASTICACHE_PORT. "
    "Install redis-py separately: pip install redis"
)


class ElastiCacheCache(CacheProvider):
    """AWS ElastiCache Redis cache stub."""

    def get(self, key: str) -> Optional[bytes]:
        raise NotImplementedError(_MSG)

    def set(self, key: str, value: bytes, *, ttl_s: int = 300) -> None:
        raise NotImplementedError(_MSG)

    def delete(self, key: str) -> None:
        raise NotImplementedError(_MSG)

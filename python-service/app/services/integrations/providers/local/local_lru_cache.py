"""LocalLruCache — in-process LRU cache with per-entry TTL.

Backed by an OrderedDict that tracks insertion order for LRU eviction.
Max 1000 entries; oldest entry is evicted when the limit is reached.

Scope limitation: single-process only. Entries are not shared across
uvicorn worker processes or gunicorn forks. For multi-process deployments
(production), switch to ElastiCacheCache (Redis) via the registry.

Thread safety: a threading.Lock guards all mutations so this provider
is safe for use in FastAPI's async thread pool (sync route handlers run
in a threadpool executor where multiple threads may call the cache).

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from typing import Optional

from ...providers_base import CacheProvider

log = logging.getLogger(__name__)

_MAX_ENTRIES = 1000


class LocalLruCache(CacheProvider):
    """In-memory LRU cache with TTL, bounded to 1000 entries.

    Limitation: single-process scope. Entries are lost on process restart and
    are NOT shared across multiple uvicorn/gunicorn workers. Use a shared Redis
    backend (ElastiCacheCache) for production multi-worker deployments.

    Implementation: OrderedDict for O(1) move-to-end on access, with a
    (value, expire_at) tuple as the stored value. Expired entries are evicted
    lazily on get() and proactively on set() when the size limit is hit.
    """

    def __init__(self) -> None:
        # Maps key → (value_bytes, expire_at_monotonic)
        self._store: OrderedDict[str, tuple[bytes, float]] = OrderedDict()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _evict_expired(self) -> None:
        """Evict all expired entries. Must be called under self._lock."""
        now = time.monotonic()
        expired = [k for k, (_, exp) in self._store.items() if exp <= now]
        for k in expired:
            del self._store[k]

    def _evict_lru_to_fit(self) -> None:
        """Evict the least-recently-used entries until size < _MAX_ENTRIES.

        Must be called under self._lock after _evict_expired().
        """
        while len(self._store) >= _MAX_ENTRIES:
            self._store.popitem(last=False)  # FIFO eviction of the oldest key.

    # ------------------------------------------------------------------
    # CacheProvider interface
    # ------------------------------------------------------------------

    def get(self, key: str) -> Optional[bytes]:
        """Return cached bytes for *key*, or None if absent or expired."""
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expire_at = entry
            if time.monotonic() > expire_at:
                del self._store[key]
                return None
            # Move to end to mark as recently used.
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: bytes, *, ttl_s: int = 300) -> None:
        """Store *value* under *key* with a TTL of *ttl_s* seconds."""
        expire_at = time.monotonic() + ttl_s
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = (value, expire_at)
            # Proactive eviction: remove expired first, then LRU if still over limit.
            self._evict_expired()
            self._evict_lru_to_fit()

    def delete(self, key: str) -> None:
        """Evict *key* from the cache. No-op if absent."""
        with self._lock:
            self._store.pop(key, None)

    def reset(self) -> None:
        """Clear the entire cache. Called by the registry on invalidation."""
        with self._lock:
            self._store.clear()
        log.debug("LocalLruCache: cache cleared by registry invalidation")

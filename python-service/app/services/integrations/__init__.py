"""
python-service/app/services/integrations
=========================================

Package that houses all CBS/CRM adapter implementations.

Public surface exported from this package:

    Adapter          — the typing.Protocol every adapter satisfies
    HealthStatus     — returned by Adapter.health()
    CustomerRecord   — returned by Adapter.pull_customer()
    RemoteDoc        — items in the list returned by Adapter.pull_documents()
    Document         — the local DMS document passed to Adapter.push_document()
    PushResult       — returned by Adapter.push_document()
    make_idempotency_key — canonical key derivation helper

    MockTemenosT24   — mock adapter for dev + test
    TemenosT24       — real adapter sketch

    get_adapter      — factory; see registry.py for selection logic
    list_adapters    — list registered adapter names
"""

from .base import (
    Adapter,
    CustomerRecord,
    Document,
    HealthStatus,
    PushResult,
    RemoteDoc,
    make_idempotency_key,
)
from .legacy import call_system, BASES, MOCK_RESPONSES
from .registry import get_adapter, list_adapters
from .temenos_t24 import MockTemenosT24, TemenosT24

__all__ = [
    # Protocol + dataclasses
    "Adapter",
    "HealthStatus",
    "CustomerRecord",
    "RemoteDoc",
    "Document",
    "PushResult",
    "make_idempotency_key",
    # Temenos T24
    "MockTemenosT24",
    "TemenosT24",
    # Registry
    "get_adapter",
    "list_adapters",
    # Legacy entry point still used by routers/integrations.py
    "call_system",
    "BASES",
    "MOCK_RESPONSES",
]

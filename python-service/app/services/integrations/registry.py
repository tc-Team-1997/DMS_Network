"""
Adapter registry — maps adapter names to instances, enforcing tenant isolation.

Usage:
    adapter = await get_adapter("temenos_t24", tenant_id="bank-eg-001", cfg={...})
    await adapter.health()

Mock selection:
    An adapter prefixed with "mock_" always returns the mock class.
    Set INTEGRATIONS_USE_MOCKS=true in the environment to force mocks globally
    (useful in CI and local dev without sandbox access).

TODO: once the vault/settings layer is complete, cfg will be loaded here from
settings.integrations[tenant_id][adapter_name] and callers will not need to
pass credentials explicitly.
"""
from __future__ import annotations

import os

from .base import Adapter
from .temenos_t24 import MockTemenosT24, TemenosT24

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, tuple[type, type]] = {
    # name → (RealClass, MockClass)
    "temenos_t24": (TemenosT24, MockTemenosT24),
    # Future adapters registered here:
    # "flexcube":        (FlexCube, MockFlexCube),
    # "finastra_fusion": (FinastraFusion, MockFinastraFusion),
    # "mambu":           (Mambu, MockMambu),
    # "thought_machine": (ThoughtMachine, MockThoughtMachine),
}

# Global mock override — set INTEGRATIONS_USE_MOCKS=true in env to force mocks.
_USE_MOCKS: bool = os.getenv("INTEGRATIONS_USE_MOCKS", "false").lower() in (
    "1",
    "true",
    "yes",
)


async def get_adapter(name: str, tenant_id: str, cfg: dict) -> Adapter:
    """
    Instantiate and configure an adapter for *tenant_id*.

    Rules:
    1. If name starts with "mock_", strip the prefix and return the mock class.
    2. If the global INTEGRATIONS_USE_MOCKS env var is set, return the mock class.
    3. Otherwise return the real class.

    Every returned adapter has already had configure(tenant_id, cfg) called,
    so it is ready to use immediately.

    Raises:
        KeyError: if *name* (after stripping "mock_") is not registered.
    """
    lookup_name = name.removeprefix("mock_") if name.startswith("mock_") else name
    use_mock = name.startswith("mock_") or _USE_MOCKS

    if lookup_name not in _REGISTRY:
        registered = ", ".join(sorted(_REGISTRY))
        raise KeyError(
            f"Unknown adapter '{lookup_name}'. Registered adapters: {registered}"
        )

    real_cls, mock_cls = _REGISTRY[lookup_name]
    cls = mock_cls if use_mock else real_cls
    instance = cls()
    await instance.configure(tenant_id, cfg)
    return instance  # type: ignore[return-value]


def list_adapters() -> list[str]:
    """Return the names of all registered adapters."""
    return sorted(_REGISTRY)

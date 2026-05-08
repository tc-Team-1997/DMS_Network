"""Abstract notification provider."""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import TypedDict


class ProviderResult(TypedDict, total=False):
    ok: bool
    id: str
    error: str


class Provider(ABC):
    """Base class every channel adapter must implement."""

    @abstractmethod
    async def send(self, to: str, subject: str, body: str, **extra) -> ProviderResult:
        """Send a message.

        Returns a dict with at minimum ``ok: bool``.
        On success may include ``id`` (provider message ID).
        On failure must include ``error`` string.
        """

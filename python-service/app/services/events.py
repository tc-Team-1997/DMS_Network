"""In-process pub/sub for live events streamed over WebSocket."""
import asyncio
from typing import Any
from collections import deque


class EventBus:
    def __init__(self, backlog: int = 100):
        self._subs: set[asyncio.Queue] = set()
        self._backlog: deque = deque(maxlen=backlog)

    async def publish(self, event: dict[str, Any]) -> None:
        self._backlog.append(event)
        dead = []
        for q in self._subs:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subs.discard(q)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        for past in self._backlog:
            try:
                q.put_nowait(past)
            except asyncio.QueueFull:
                break
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)


bus = EventBus()


def emit(event_type: str, **data) -> None:
    """Fire-and-forget helper callable from sync code."""
    event = {"type": event_type, **data}
    # Best-effort ship to SIEM. Never raise from the emit path.
    try:
        from .siem import ship
        ship(event)
    except Exception:
        pass
    try:
        from .kafka_bus import publish as kafka_publish
        kafka_publish(event)
    except Exception:
        pass
    try:
        from .ledger import ship as ledger_ship
        ledger_ship(event)
    except Exception:
        pass
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(bus.publish(event))
        else:
            loop.run_until_complete(bus.publish(event))
    except RuntimeError:
        pass

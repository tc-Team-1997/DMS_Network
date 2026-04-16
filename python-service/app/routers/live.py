"""Grafana Live / SSE bridge.

Grafana Live panels can consume Server-Sent Events from any authenticated URL.
This router re-emits the same events that flow over /ws/events as `text/event-stream`
so operations teams get realtime dashboards (document uploads, workflow actions,
fraud alerts, WAF blocks) without wiring a WebSocket plugin.

Two endpoints:
  GET /api/v1/live/events  — SSE stream (pass X-API-Key or ?api_key=)
  GET /api/v1/live/sample  — tiny demo generator for Grafana Live quickstart
"""
import asyncio
import json

from fastapi import APIRouter, Query, status
from fastapi.responses import StreamingResponse

from ..config import settings
from ..services.events import bus

router = APIRouter(prefix="/api/v1/live", tags=["live"])


async def _sse(api_key: str):
    if api_key != settings.API_KEY:
        yield b"event: error\ndata: invalid_api_key\n\n"
        return
    q = bus.subscribe()
    try:
        yield b":ok\n\n"  # comment line — keeps the stream open
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=15.0)
                data = json.dumps(event, default=str)
                payload = f"event: {event.get('type','event')}\ndata: {data}\n\n"
                yield payload.encode("utf-8")
            except asyncio.TimeoutError:
                yield b":keepalive\n\n"
    finally:
        bus.unsubscribe(q)


@router.get("/events")
async def events(api_key: str = Query("")):
    return StreamingResponse(_sse(api_key), media_type="text/event-stream")


@router.get("/sample")
async def sample(api_key: str = Query("")):
    """Generator that emits a synthetic stream for Grafana Live quickstart."""
    async def gen():
        if api_key != settings.API_KEY:
            yield b"event: error\ndata: invalid_api_key\n\n"; return
        import random, time
        for i in range(120):
            payload = {"type": "sample.tick", "i": i,
                       "value": round(random.random() * 100, 2),
                       "ts": time.time()}
            yield f"data: {json.dumps(payload)}\n\n".encode("utf-8")
            await asyncio.sleep(1.0)
    return StreamingResponse(gen(), media_type="text/event-stream")

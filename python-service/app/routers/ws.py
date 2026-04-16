import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status

from ..config import settings
from ..services.events import bus

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/events")
async def ws_events(websocket: WebSocket, api_key: str = Query(default="")):
    if api_key != settings.API_KEY:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await websocket.accept()
    q = bus.subscribe()
    try:
        await websocket.send_json({"type": "hello", "service": settings.APP_NAME})
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=30.0)
                await websocket.send_json(event)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(q)

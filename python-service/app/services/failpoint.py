"""Runtime failpoint — injected latency for chaos drills.

Reads a single-line file at /tmp/failpoint_latency_ms. If present, every HTTP
request sleeps that many milliseconds before processing. Only compiled in when
CHAOS_FAILPOINTS=1.
"""
import os, time
from pathlib import Path
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

FAILPOINT_PATH = Path("/tmp/failpoint_latency_ms")
ENABLED = os.environ.get("CHAOS_FAILPOINTS", "").strip() in ("1", "true", "yes")


class FailpointMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if ENABLED and FAILPOINT_PATH.exists():
            try:
                ms = int(FAILPOINT_PATH.read_text().strip() or "0")
                if ms > 0:
                    time.sleep(ms / 1000.0)
            except Exception:
                pass
        return await call_next(request)

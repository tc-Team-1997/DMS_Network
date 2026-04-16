"""Lightweight in-app WAF.

Intended as a second line of defence behind an edge WAF (AWS WAF / Cloudflare /
ModSecurity). These rules catch the common web attacks that hit any service:
SQLi, XSS, path traversal, known scanner user agents, and request-rate abuse.

A production deployment should route traffic through an edge WAF and rely on this
only as a belt-and-braces layer. When `WAF_MODE=monitor` (default) offenses are
logged + emitted to SIEM; set `WAF_MODE=block` to return 403.
"""
from __future__ import annotations
import os
import re
import time
from collections import deque, defaultdict

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


_ENV_MODE = os.environ.get("WAF_MODE", "monitor").lower()
RATE_WINDOW_SEC = int(os.environ.get("WAF_RATE_WINDOW", "60"))
RATE_LIMIT = int(os.environ.get("WAF_RATE_LIMIT", "600"))   # per IP/window

def current_mode() -> str:
    """Check sentinel file first so the remediation agent can flip us to block."""
    try:
        from pathlib import Path
        p = Path("/tmp/dms_waf_mode")
        if p.exists():
            return p.read_text().strip().lower() or _ENV_MODE
    except Exception:
        pass
    return _ENV_MODE


MODE = _ENV_MODE  # kept for back-compat; real lookups go through current_mode()


RULES: list[tuple[str, re.Pattern]] = [
    ("sqli",       re.compile(r"('|\").*(or|and)\s+[\d\w]+=[\d\w]+|union\s+select|/\*.*\*/|;--", re.I)),
    ("xss",        re.compile(r"<\s*script|javascript:|on\w+\s*=", re.I)),
    ("traversal",  re.compile(r"\.\./|\.\.\\|%2e%2e%2f", re.I)),
    ("cmd_inject", re.compile(r"[;&|`]\s*(?:cat|ls|whoami|wget|curl|nc|sh)\b", re.I)),
    ("scanner_ua", re.compile(r"sqlmap|nikto|nmap|acunetix|nessus|wpscan", re.I)),
    ("ssrf",       re.compile(r"(?:^|[=\"'])(?:http://169\.254|file://|gopher://)", re.I)),
]


_rate: dict[str, deque] = defaultdict(deque)


def _client_ip(req: Request) -> str:
    return req.headers.get("x-forwarded-for", "").split(",")[0].strip() or (req.client.host if req.client else "?")


def _rate_exceeded(ip: str) -> bool:
    now = time.time()
    q = _rate[ip]
    while q and q[0] < now - RATE_WINDOW_SEC:
        q.popleft()
    q.append(now)
    return len(q) > RATE_LIMIT


def _scan(text: str) -> list[str]:
    hits = []
    for name, pat in RULES:
        if pat.search(text or ""):
            hits.append(name)
    return hits


class WAFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        ip = _client_ip(request)
        ua = request.headers.get("user-agent", "")
        target = f"{request.url.path}?{request.url.query}"

        hits = _scan(target) + _scan(ua)

        if _rate_exceeded(ip):
            hits.append("rate_limit")

        if hits:
            try:
                from .events import emit
                emit("waf.alert", ip=ip, path=request.url.path, rules=hits, mode=MODE,
                     user_agent=ua[:200])
            except Exception:
                pass
            if current_mode() == "block":
                return JSONResponse(
                    {"error": "blocked_by_waf", "rules": hits},
                    status_code=403,
                )
        return await call_next(request)

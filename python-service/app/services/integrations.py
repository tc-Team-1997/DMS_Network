import json
import time
from typing import Any
import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models import IntegrationLog

BASES = {
    "cbs": settings.CBS_BASE_URL,
    "los": settings.LOS_BASE_URL,
    "aml": settings.AML_BASE_URL,
    "ifrs9": settings.IFRS9_BASE_URL,
}


MOCK_RESPONSES = {
    "cbs": {"customer_found": True, "kyc_status": "VERIFIED", "risk_band": "LOW"},
    "los": {"loan_application_created": True, "ref": "LOS-REF-0001"},
    "aml": {"watchlist_hit": False, "score": 0.08},
    "ifrs9": {"stage": 1, "ecl": 124.5},
}


async def call_system(db: Session, system: str, endpoint: str, method: str = "POST", payload: dict | None = None) -> dict[str, Any]:
    if system not in BASES:
        raise ValueError(f"Unknown system: {system}")

    base = BASES[system].rstrip("/")
    url = f"{base}/{endpoint.lstrip('/')}"
    payload = payload or {}
    t0 = time.time()
    status_code = 200
    response_body: dict[str, Any] = {}

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.request(method, url, json=payload)
            status_code = resp.status_code
            try:
                response_body = resp.json()
            except Exception:
                response_body = {"raw": resp.text[:1000]}
    except Exception as e:
        # Fall back to mocked response for dev/demo
        status_code = 200
        response_body = {"mock": True, "system": system, **MOCK_RESPONSES.get(system, {}), "echo": payload}
        response_body["_error"] = str(e)[:200]

    latency = int((time.time() - t0) * 1000)
    log = IntegrationLog(
        system=system,
        endpoint=endpoint,
        method=method,
        status_code=status_code,
        latency_ms=latency,
        request_json=json.dumps(payload)[:4000],
        response_json=json.dumps(response_body)[:4000],
    )
    db.add(log)
    db.commit()
    return {"status_code": status_code, "latency_ms": latency, "body": response_body}

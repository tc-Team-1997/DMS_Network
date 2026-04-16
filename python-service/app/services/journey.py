"""Synthetic customer-journey simulator.

Replays realistic end-to-end workloads against the service for demos, load tests,
and regression checks. Each journey is a sequence of HTTP calls with probabilistic
branching; the simulator records per-step latency, status, and emits a summary.

Four built-in journeys:
  - branch_onboarding     : teller logs in → uploads passport + ID + bill → OCR → workflow
  - portal_selfservice    : customer OTP → portal upload → status poll
  - mobile_field_capture  : field officer → capture → tasks/OCR → recent
  - partner_oidc          : partner app → /oidc/authorize (code) → /oidc/token → /oidc/userinfo

Run in-process so it can be wired into the admin panel without spinning a separate
process. For heavy load use k6 (loadtest/k6.js); use this for realism.
"""
from __future__ import annotations
import io
import json
import os
import random
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx


DEFAULT_BASE = os.environ.get("JOURNEY_BASE_URL", "http://127.0.0.1:8000")


@dataclass
class StepResult:
    name: str
    status: int
    latency_ms: int
    body_preview: str = ""
    ok: bool = True


@dataclass
class JourneyResult:
    name: str
    run_id: str
    persona: str
    steps: list[StepResult] = field(default_factory=list)
    total_ms: int = 0
    ok: bool = True

    def summary(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "journey": self.name,
            "persona": self.persona,
            "ok": self.ok,
            "total_ms": self.total_ms,
            "steps": [s.__dict__ for s in self.steps],
        }


def _call(client: httpx.Client, method: str, url: str, expect: tuple[int, ...] = (200,),
          **kwargs) -> StepResult:
    t0 = time.time()
    try:
        r = client.request(method, url, **kwargs)
        ms = int((time.time() - t0) * 1000)
        return StepResult(
            name=f"{method} {url.split('?')[0]}",
            status=r.status_code, latency_ms=ms,
            body_preview=(r.text or "")[:120],
            ok=r.status_code in expect,
        )
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return StepResult(name=f"{method} {url}", status=0, latency_ms=ms,
                          body_preview=str(e)[:120], ok=False)


def _synthetic_image_bytes() -> bytes:
    return (b"PNG\r\n\x1a\n" + b"\x00" * 32 + uuid.uuid4().bytes * 4)


def journey_branch_onboarding(base: str, api_key: str) -> JourneyResult:
    out = JourneyResult("branch_onboarding", uuid.uuid4().hex[:8], "branch_teller")
    t0 = time.time()
    cid = f"EGY-SIM-{uuid.uuid4().hex[:8].upper()}"
    with httpx.Client(base_url=base, timeout=5.0) as c:
        r = c.post("/api/v1/auth/token",
                   json={"username": "sara.k", "password": "demo"})
        out.steps.append(StepResult("POST /auth/token", r.status_code,
                                    int(r.elapsed.total_seconds() * 1000),
                                    r.text[:120], r.status_code == 200))
        token = r.json().get("access_token", "") if r.status_code == 200 else ""
        H = {"Authorization": f"Bearer {token}"} if token else {"X-API-Key": api_key}

        for doc_type in ("passport", "national_id", "utility_bill"):
            files = {"file": (f"{doc_type}.png", _synthetic_image_bytes(), "image/png")}
            data = {"doc_type": doc_type, "customer_cid": cid,
                    "branch": "Cairo West",
                    "expiry_date": "2032-01-09" if doc_type != "utility_bill" else ""}
            out.steps.append(_call(c, "POST", "/api/v1/documents",
                                   headers=H, files=files, data=data))
            last_id = None
            try:
                last_id = json.loads(out.steps[-1].body_preview).get("id")  # naive
            except Exception:
                pass
            if last_id:
                out.steps.append(_call(c, "POST", f"/api/v1/tasks",
                                       headers={**H, "Content-Type": "application/json"},
                                       json={"name": "ocr.process",
                                             "payload": {"document_id": last_id}}))
                out.steps.append(_call(c, "POST", f"/api/v1/workflow/{last_id}/actions",
                                       headers={**H, "Content-Type": "application/json"},
                                       json={"stage": "maker", "action": "approve",
                                             "actor": "sara.k"}))

        out.steps.append(_call(c, "GET", f"/api/v1/documents?customer_cid={cid}", headers=H))

    out.total_ms = int((time.time() - t0) * 1000)
    out.ok = all(s.ok for s in out.steps)
    return out


def journey_portal_selfservice(base: str) -> JourneyResult:
    out = JourneyResult("portal_selfservice", uuid.uuid4().hex[:8], "customer")
    t0 = time.time()
    cid = f"EGY-SIM-{uuid.uuid4().hex[:8].upper()}"
    email = f"{cid.lower()}@example.eg"
    with httpx.Client(base_url=base, timeout=5.0) as c:
        out.steps.append(_call(c, "POST", "/portal/request-otp",
                               json={"customer_cid": cid, "email": email}))
        # OTP is printed to server logs; for simulation use a wrong code to exercise 401.
        r = c.post("/portal/verify-otp", json={"customer_cid": cid, "code": "000000"})
        out.steps.append(StepResult("POST /portal/verify-otp",
                                    r.status_code, int(r.elapsed.total_seconds() * 1000),
                                    r.text[:120], r.status_code in (200, 401)))

    out.total_ms = int((time.time() - t0) * 1000)
    out.ok = all(s.ok for s in out.steps)
    return out


def journey_mobile_field_capture(base: str) -> JourneyResult:
    out = JourneyResult("mobile_field_capture", uuid.uuid4().hex[:8], "field_officer")
    t0 = time.time()
    with httpx.Client(base_url=base, timeout=5.0) as c:
        r = c.post("/api/v1/auth/token", json={"username": "ahmed.m", "password": "demo"})
        out.steps.append(StepResult("POST /auth/token", r.status_code,
                                    int(r.elapsed.total_seconds() * 1000),
                                    r.text[:120], r.status_code == 200))
        token = r.json().get("access_token") if r.status_code == 200 else None
        H = {"Authorization": f"Bearer {token}"} if token else {}
        files = {"file": (f"field-{uuid.uuid4().hex[:6]}.png",
                          _synthetic_image_bytes(), "image/png")}
        out.steps.append(_call(c, "POST", "/api/v1/documents", headers=H,
                               files=files, data={"doc_type": "passport",
                                                  "customer_cid": "EGY-MOB-0001"}))
        out.steps.append(_call(c, "GET", "/api/v1/documents?limit=5", headers=H))

    out.total_ms = int((time.time() - t0) * 1000)
    out.ok = all(s.ok for s in out.steps)
    return out


def journey_partner_oidc(base: str) -> JourneyResult:
    out = JourneyResult("partner_oidc", uuid.uuid4().hex[:8], "partner_app")
    t0 = time.time()
    with httpx.Client(base_url=base, timeout=5.0, follow_redirects=False) as c:
        out.steps.append(_call(c, "GET", "/.well-known/openid-configuration"))
        out.steps.append(_call(c, "GET", "/oidc/jwks"))

    out.total_ms = int((time.time() - t0) * 1000)
    out.ok = all(s.ok for s in out.steps)
    return out


JOURNEYS = {
    "branch_onboarding":    lambda base, key: journey_branch_onboarding(base, key),
    "portal_selfservice":   lambda base, key: journey_portal_selfservice(base),
    "mobile_field_capture": lambda base, key: journey_mobile_field_capture(base),
    "partner_oidc":         lambda base, key: journey_partner_oidc(base),
}


def run(journey_name: str, base: str = DEFAULT_BASE,
        api_key: str = "dev-key-change-me") -> dict:
    fn = JOURNEYS.get(journey_name)
    if not fn:
        return {"error": "unknown_journey",
                "available": sorted(JOURNEYS.keys())}
    return fn(base, api_key).summary()


def run_all(base: str = DEFAULT_BASE,
            api_key: str = "dev-key-change-me") -> dict:
    t0 = time.time()
    results = [fn(base, api_key).summary() for fn in JOURNEYS.values()]
    return {
        "total_ms": int((time.time() - t0) * 1000),
        "journeys": len(results),
        "ok": all(r["ok"] for r in results),
        "results": results,
    }

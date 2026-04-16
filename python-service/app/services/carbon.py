"""Carbon-footprint telemetry.

Two scopes:
  - **Per-request**: CPU time × region's grid gCO2/kWh × server's TDP/CPU ratio
    → accumulated by endpoint + tenant.
  - **Per-workflow** (offline job): retroactively attribute compute to each
    workflow step by joining on document_id.

Configurable via env:
    CARBON_REGION=EG             ISO country or grid zone
    CARBON_G_PER_KWH=506         gCO2/kWh (EG default; source: Ember 2024)
    CARBON_CPU_W=25              per-core TDP at 100% utilization
    CARBON_VCPU=2                how many vCPU this pod was allocated

Exposed as Prometheus histograms `dms_carbon_gco2e_total{tenant,endpoint}` so
sustainability teams graph it alongside request rate / latency.
"""
from __future__ import annotations
import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


CARBON_REGION = os.environ.get("CARBON_REGION", "EG")
G_PER_KWH = float(os.environ.get("CARBON_G_PER_KWH", "506"))   # Egypt default
CPU_W = float(os.environ.get("CARBON_CPU_W", "25"))
VCPU = float(os.environ.get("CARBON_VCPU", "2"))

# Prometheus hook (optional — reuses the same registry if available).
try:
    from prometheus_client import Counter, Histogram
    CARBON_TOTAL = Counter("dms_carbon_gco2e_total",
                           "Estimated gCO2e emitted",
                           ["tenant", "endpoint"])
    CARBON_REQ_HIST = Histogram("dms_carbon_gco2e_per_request",
                                "gCO2e per HTTP request",
                                buckets=[0.001, 0.01, 0.1, 1, 10, 100])
except Exception:
    class _Noop:
        def labels(self, *_, **__): return self
        def inc(self, *_): pass
        def observe(self, *_): pass
    CARBON_TOTAL = CARBON_REQ_HIST = _Noop()


_lock = Lock()
_by_endpoint: dict[str, float] = defaultdict(float)
_by_tenant: dict[str, float] = defaultdict(float)
_total_requests = 0


def _cpu_ms_to_g(cpu_seconds: float) -> float:
    """cpu-seconds → gCO2e using grid intensity + CPU watts."""
    kwh = (cpu_seconds * CPU_W / VCPU) / 3_600_000.0
    return kwh * G_PER_KWH


class CarbonMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        import time as _t
        t0 = _t.process_time()
        response = await call_next(request)
        cpu = max(0.0, _t.process_time() - t0)
        g = _cpu_ms_to_g(cpu)

        route = request.scope.get("route")
        path = getattr(route, "path", None) or request.url.path
        tenant = request.headers.get("x-tenant", "default")

        with _lock:
            global _total_requests
            _total_requests += 1
            _by_endpoint[path] += g
            _by_tenant[tenant] += g

        CARBON_TOTAL.labels(tenant, path).inc(g)
        CARBON_REQ_HIST.observe(g)
        # Surface as a response header for UX debugging.
        try:
            response.headers["X-Carbon-gCO2e"] = f"{g:.6f}"
        except Exception:
            pass
        return response


def snapshot() -> dict:
    with _lock:
        return {
            "region": CARBON_REGION,
            "g_per_kwh": G_PER_KWH,
            "total_requests": _total_requests,
            "total_gco2e": round(sum(_by_endpoint.values()), 3),
            "by_endpoint": {k: round(v, 4) for k, v in sorted(_by_endpoint.items(),
                            key=lambda x: -x[1])[:25]},
            "by_tenant": {k: round(v, 4) for k, v in _by_tenant.items()},
        }


def estimate_workflow(cpu_seconds: float) -> dict:
    """Utility for batch jobs / workers to report their footprint directly."""
    g = _cpu_ms_to_g(cpu_seconds)
    CARBON_TOTAL.labels("batch", "worker").inc(g)
    return {"cpu_seconds": cpu_seconds, "gco2e": round(g, 6), "region": CARBON_REGION}

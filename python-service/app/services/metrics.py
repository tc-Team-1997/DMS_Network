"""Prometheus metrics — collected via middleware, exposed at /metrics."""
import time
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

try:
    from prometheus_client import (
        Counter, Histogram, Gauge, CONTENT_TYPE_LATEST, generate_latest,
    )
except Exception:  # prometheus_client optional
    Counter = Histogram = Gauge = None
    CONTENT_TYPE_LATEST = "text/plain"
    def generate_latest():  # type: ignore
        return b"# prometheus_client not installed\n"


if Counter is not None:
    REQ_COUNT = Counter("dms_http_requests_total",
                        "HTTP requests", ["method", "path", "status"])
    REQ_LATENCY = Histogram("dms_http_request_seconds",
                            "HTTP request latency", ["method", "path"])
    DOCS_UPLOADED = Counter("dms_documents_uploaded_total",
                            "Documents uploaded", ["tenant", "doc_type"])
    OCR_CONFIDENCE = Histogram("dms_ocr_confidence",
                               "OCR confidence distribution",
                               buckets=[0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.92, 0.95, 0.97, 0.99])
    TASKS_QUEUED = Gauge("dms_tasks_queued", "Background tasks in queue")
    DUP_MATCHES = Counter("dms_duplicate_matches_total",
                          "Duplicate matches detected", ["match_type"])
else:
    class _Noop:
        def labels(self, *_, **__): return self
        def inc(self, *_): pass
        def observe(self, *_): pass
        def set(self, *_): pass
    REQ_COUNT = REQ_LATENCY = DOCS_UPLOADED = OCR_CONFIDENCE = TASKS_QUEUED = DUP_MATCHES = _Noop()


class PrometheusMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        t0 = time.time()
        response = await call_next(request)
        # Use route path template when available to avoid cardinality blowup
        route = request.scope.get("route")
        path = getattr(route, "path", None) or request.url.path
        elapsed = time.time() - t0
        REQ_COUNT.labels(request.method, path, str(response.status_code)).inc()
        REQ_LATENCY.labels(request.method, path).observe(elapsed)
        return response


def metrics_response() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

"""OpenTelemetry tracing — enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set.

Auto-instruments FastAPI, httpx, SQLAlchemy. Exports via OTLP (gRPC or HTTP)
to any collector: Jaeger, Tempo, Honeycomb, Datadog via OTLP, etc.

Env:
    OTEL_EXPORTER_OTLP_ENDPOINT   e.g. http://otel-collector:4318
    OTEL_SERVICE_NAME             default "nbe-dms-python"
    OTEL_TRACES_EXPORTER          "otlp" (default) | "console"
"""
import os


def setup_tracing(app, engine) -> bool:
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    exporter_kind = os.environ.get("OTEL_TRACES_EXPORTER", "otlp").strip()
    if not endpoint and exporter_kind != "console":
        return False

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource, SERVICE_NAME
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    except Exception as e:
        print(f"[tracing] OTel packages missing, skipping: {e}")
        return False

    resource = Resource.create({
        SERVICE_NAME: os.environ.get("OTEL_SERVICE_NAME", "nbe-dms-python"),
        "deployment.environment": os.environ.get("APP_ENV", "dev"),
    })
    provider = TracerProvider(resource=resource)

    if exporter_kind == "console":
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    else:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
            exporter = OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces")
        except Exception:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
            exporter = OTLPSpanExporter(endpoint=endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))

    trace.set_tracer_provider(provider)

    FastAPIInstrumentor.instrument_app(app)
    HTTPXClientInstrumentor().instrument()
    SQLAlchemyInstrumentor().instrument(engine=engine)
    return True

"""Kafka producer + consumer for downstream data-mesh consumers.

Every emit() already fans out to the local WebSocket bus + SIEM; now it also
publishes to Kafka when KAFKA_BOOTSTRAP is configured. Topics default to
`nbe.dms.<event-type-first-segment>` (e.g. `nbe.dms.document`, `nbe.dms.workflow`,
`nbe.dms.fraud`) — override with the `KAFKA_TOPIC_PREFIX` env.

Consumers (BI ETL, fraud ML trainer, data-lake sink) subscribe to a topic glob
and get ECS-normalized JSON identical to what the SIEM pipeline sees.

Graceful degradation: if `aiokafka` / `confluent-kafka-python` aren't installed,
or the broker is unreachable, we skip without raising — the rest of emit() keeps
working. The shipper is lazy-initialized to avoid startup hangs.
"""
from __future__ import annotations
import json
import os
import threading
from datetime import datetime
from typing import Any, Optional

KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "").strip()
TOPIC_PREFIX = os.environ.get("KAFKA_TOPIC_PREFIX", "nbe.dms").strip()
CLIENT_ID = os.environ.get("KAFKA_CLIENT_ID", "nbe-dms-python")

_producer = None
_lock = threading.Lock()


def is_enabled() -> bool:
    return bool(KAFKA_BOOTSTRAP)


def _lazy_producer():
    global _producer
    if _producer is not None:
        return _producer
    if not is_enabled():
        return None
    with _lock:
        if _producer is not None:
            return _producer
        try:
            from confluent_kafka import Producer
            _producer = Producer({
                "bootstrap.servers": KAFKA_BOOTSTRAP,
                "client.id": CLIENT_ID,
                "enable.idempotence": True,
                "acks": "all",
                "compression.type": "zstd",
                "linger.ms": 10,
            })
        except Exception as e:
            _producer = False  # sentinel — keep silent, try again next restart
            print(f"[kafka] producer init failed: {e}")
    return _producer


def topic_for(event_type: str) -> str:
    head = (event_type or "event").split(".", 1)[0]
    return f"{TOPIC_PREFIX}.{head}"


def publish(event: dict[str, Any]) -> bool:
    p = _lazy_producer()
    if not p:
        return False
    try:
        record = {
            "@timestamp": datetime.utcnow().isoformat() + "Z",
            "service": {"name": "nbe-dms-python"},
            "event": {"action": event.get("type", "unknown"), "dataset": "nbe.dms"},
            "nbe": event,
        }
        key = str(event.get("document_id") or event.get("id") or "").encode() or None
        p.produce(topic_for(event.get("type", "event")),
                  value=json.dumps(record, default=str).encode("utf-8"),
                  key=key)
        p.poll(0)
        return True
    except Exception as e:
        print(f"[kafka] publish failed: {e}")
        return False


def flush(timeout: float = 2.0) -> None:
    p = _lazy_producer()
    if p and p is not False:
        try:
            p.flush(timeout)
        except Exception:
            pass

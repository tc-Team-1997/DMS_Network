"""Audit log shipper to SIEM.

Backends auto-selected by env:
  - Splunk HEC:  SIEM_SPLUNK_HEC_URL + SIEM_SPLUNK_TOKEN
  - Elastic ECS: SIEM_ELASTIC_URL + SIEM_ELASTIC_INDEX [+ SIEM_ELASTIC_API_KEY]
  - Syslog:      SIEM_SYSLOG_HOST + SIEM_SYSLOG_PORT (UDP/RFC5424)
  - File (default fallback): storage/audit.jsonl — always written so nothing is lost on network errors.

The WebSocket event bus forwards every emit() into this shipper in the background,
so existing code that calls `emit()` auto-feeds the SIEM without further changes.
"""
from __future__ import annotations
import json
import os
import socket
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from ..config import settings


AUDIT_FILE = Path(settings.STORAGE_DIR).parent / "audit.jsonl"
AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)


def _normalize(event: dict[str, Any]) -> dict[str, Any]:
    """ECS-flavored common event structure with PII auto-redaction."""
    now = datetime.utcnow().isoformat() + "Z"
    try:
        from .redaction import redact_event
        event = redact_event(event)
    except Exception:
        pass
    return {
        "@timestamp": now,
        "ecs": {"version": "8.10"},
        "event": {
            "kind": "event",
            "category": "process",
            "action": event.get("type", "unknown"),
            "dataset": "nbe.dms",
        },
        "service": {"name": "nbe-dms-python"},
        "labels": {k: v for k, v in event.items() if k != "type" and isinstance(v, (str, int, float, bool))},
        "nbe": event,
    }


def _file_write(record: dict) -> None:
    with open(AUDIT_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def _splunk_send(record: dict) -> bool:
    url = os.environ.get("SIEM_SPLUNK_HEC_URL", "").strip()
    tok = os.environ.get("SIEM_SPLUNK_TOKEN", "").strip()
    if not (url and tok):
        return False
    try:
        payload = {"time": int(time.time()), "sourcetype": "_json",
                   "source": "nbe-dms", "event": record}
        with httpx.Client(timeout=2.0, verify=True) as c:
            r = c.post(url, headers={"Authorization": f"Splunk {tok}"}, json=payload)
            return 200 <= r.status_code < 300
    except Exception:
        return False


def _elastic_send(record: dict) -> bool:
    url = os.environ.get("SIEM_ELASTIC_URL", "").strip()
    index = os.environ.get("SIEM_ELASTIC_INDEX", "nbe-dms-audit").strip()
    key = os.environ.get("SIEM_ELASTIC_API_KEY", "").strip()
    if not url:
        return False
    try:
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"ApiKey {key}"
        with httpx.Client(timeout=2.0) as c:
            r = c.post(f"{url.rstrip('/')}/{index}/_doc", headers=headers, json=record)
            return 200 <= r.status_code < 300
    except Exception:
        return False


def _syslog_send(record: dict) -> bool:
    host = os.environ.get("SIEM_SYSLOG_HOST", "").strip()
    port = int(os.environ.get("SIEM_SYSLOG_PORT", "514"))
    if not host:
        return False
    try:
        msg = f"<134>1 {record['@timestamp']} nbe-dms app - - - {json.dumps(record)}"
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.sendto(msg.encode("utf-8"), (host, port))
        return True
    except Exception:
        return False


def ship(event: dict[str, Any]) -> dict:
    record = _normalize(event)
    _file_write(record)  # always keep a local copy
    sent = {
        "file": True,
        "splunk": _splunk_send(record),
        "elastic": _elastic_send(record),
        "syslog": _syslog_send(record),
    }
    return sent

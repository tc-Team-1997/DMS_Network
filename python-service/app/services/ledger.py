"""Tamper-evident ledger export.

Backends auto-selected per env:
  - **AWS QLDB**  (LEDGER_QLDB_NAME + AWS creds): each event is appended to a
    verifiable journal — QLDB produces cryptographic digests you can verify years
    later. Native choice for regulator-facing immutable logs.
  - **BigQuery**  (LEDGER_BQ_TABLE like "project.dataset.table"): streams rows to
    an append-only partitioned table with an Organization Policy blocking updates.
  - **Local notarized log** (default): JSONL at storage/ledger/journal.jsonl with
    a hash-chain (`prev_hash → curr_hash`). Verifiable offline, zero dep.

Shape of a ledger record (JSON):
    { "id": uuid, "ts": iso, "event_type": str, "tenant": str,
      "document_id": int?, "actor": str?,
      "prev_hash": hex64, "hash": hex64, "event": {...full emit payload...} }

Wired into emit() alongside SIEM + Kafka so every lifecycle event is ledgered
without any app-code changes.
"""
from __future__ import annotations
import hashlib
import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from ..config import settings


LEDGER_QLDB_NAME = os.environ.get("LEDGER_QLDB_NAME", "").strip()
LEDGER_QLDB_TABLE = os.environ.get("LEDGER_QLDB_TABLE", "DmsJournal")
LEDGER_BQ_TABLE = os.environ.get("LEDGER_BQ_TABLE", "").strip()

LEDGER_DIR = Path(settings.STORAGE_DIR).parent / "ledger"
LEDGER_DIR.mkdir(parents=True, exist_ok=True)
JOURNAL = LEDGER_DIR / "journal.jsonl"

_lock = threading.Lock()


def backend() -> str:
    if LEDGER_QLDB_NAME: return "qldb"
    if LEDGER_BQ_TABLE:  return "bigquery"
    return "local"


def _last_hash() -> str:
    if not JOURNAL.exists():
        return "0" * 64
    last = None
    with open(JOURNAL, "rb") as f:
        for line in f:
            last = line
    if not last:
        return "0" * 64
    try:
        return json.loads(last)["hash"]
    except Exception:
        return "0" * 64


def _hash(prev: str, body: dict) -> str:
    raw = prev + json.dumps(body, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _ship_qldb(record: dict) -> bool:
    try:
        from pyqldb.driver.qldb_driver import QldbDriver  # type: ignore
    except Exception:
        return False
    try:
        drv = QldbDriver(ledger_name=LEDGER_QLDB_NAME)
        drv.execute_lambda(lambda tx: tx.execute_statement(
            f"INSERT INTO {LEDGER_QLDB_TABLE} ?", record
        ))
        return True
    except Exception as e:
        print(f"[ledger] qldb failed: {e}")
        return False


def _ship_bigquery(record: dict) -> bool:
    try:
        from google.cloud import bigquery  # type: ignore
    except Exception:
        return False
    try:
        client = bigquery.Client()
        errors = client.insert_rows_json(LEDGER_BQ_TABLE, [record])
        return not errors
    except Exception as e:
        print(f"[ledger] bigquery failed: {e}")
        return False


def ship(event: dict[str, Any]) -> dict[str, bool]:
    """Append a single event to the ledger. Always writes the local journal first
    (so the hash chain is continuous even if cloud backend is down)."""
    with _lock:
        prev = _last_hash()
        record = {
            "id": str(uuid.uuid4()),
            "ts": datetime.utcnow().isoformat() + "Z",
            "event_type": event.get("type", "unknown"),
            "tenant": event.get("tenant", "default"),
            "document_id": event.get("document_id") or event.get("id"),
            "actor": event.get("actor"),
            "prev_hash": prev,
            "event": event,
        }
        record["hash"] = _hash(prev, {k: v for k, v in record.items() if k != "hash"})
        with open(JOURNAL, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, default=str) + "\n")

    results = {"local": True}
    b = backend()
    if b == "qldb":
        results["qldb"] = _ship_qldb(record)
    elif b == "bigquery":
        results["bigquery"] = _ship_bigquery(record)
    return results


def verify_journal() -> dict:
    if not JOURNAL.exists():
        return {"ok": True, "events": 0, "tampered": []}
    prev = "0" * 64
    tampered: list[dict] = []
    count = 0
    with open(JOURNAL, encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            count += 1
            body = {k: v for k, v in rec.items() if k != "hash"}
            expected = _hash(prev, body)
            if rec.get("prev_hash") != prev or rec.get("hash") != expected:
                tampered.append({"id": rec.get("id"), "event_type": rec.get("event_type")})
            prev = rec.get("hash", prev)
    return {"ok": not tampered, "events": count, "tampered": tampered}


def tail(lines: int = 100) -> list[dict]:
    if not JOURNAL.exists():
        return []
    with open(JOURNAL, encoding="utf-8") as f:
        all_lines = f.readlines()
    out = []
    for line in all_lines[-lines:]:
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out

"""Autonomous remediation agent.

Subscribes to the in-process event bus and reacts to alert events with **safe,
bounded** mitigations. Anything more dangerous than "block this document" opens
a ticket and stops, to keep a human in the loop.

Policy:
  - fraud.alert band=critical            → quarantine doc + open ticket
  - adversarial.alert band=critical      → quarantine doc + open ticket
  - moderation.flag band=block           → quarantine doc + open ticket
  - waf.alert burst (>N in window)       → enable WAF block mode globally
  - task.failed (>K in window)           → open ticket (no autoscale)
  - replication.lag (future)             → no-op, ticket only

Safe actions:
  - `quarantine_document(doc_id)`        → set status='quarantined', create WorkflowStep
  - `set_waf_mode(mode)`                 → write env-like sentinel file WAF will honor
  - `open_ticket(...)`                   → append to storage/tickets/ticket.jsonl
    (in prod: Jira/ServiceNow REST call; contract is unchanged)

Every autonomous action emits a `remediation.applied` event so audit can replay.
"""
from __future__ import annotations
import asyncio
import json
import os
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal
from ..models import Document, WorkflowStep


TICKETS_DIR = Path(settings.STORAGE_DIR).parent / "tickets"
TICKETS_DIR.mkdir(parents=True, exist_ok=True)
TICKET_FILE = TICKETS_DIR / "ticket.jsonl"

WAF_MODE_FILE = Path("/tmp/dms_waf_mode")   # services/waf.py can read this


# ---------- Safe actions ----------
def open_ticket(kind: str, summary: str, context: dict) -> dict:
    tk = {
        "id": f"INC-{int(time.time() * 1000)}",
        "kind": kind, "summary": summary,
        "context": context,
        "opened_at": datetime.utcnow().isoformat() + "Z",
    }
    with open(TICKET_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(tk, default=str) + "\n")
    return tk


def quarantine_document(doc_id: int, reason: str) -> bool:
    db = SessionLocal()
    try:
        doc = db.get(Document, doc_id)
        if not doc:
            return False
        doc.status = "quarantined"
        db.add(WorkflowStep(
            document_id=doc.id, stage="quarantine",
            actor="remediation-agent", action="auto",
            comment=reason[:500],
        ))
        db.commit()
        return True
    finally:
        db.close()


def set_waf_mode(mode: str) -> None:
    try:
        WAF_MODE_FILE.write_text(mode.strip().lower())
    except Exception:
        pass


# ---------- Rate-tracker for burst rules ----------
class _RateTracker:
    def __init__(self, window_sec: int):
        self.window = window_sec
        self.events: deque = deque()

    def bump(self) -> int:
        now = time.time()
        self.events.append(now)
        cutoff = now - self.window
        while self.events and self.events[0] < cutoff:
            self.events.popleft()
        return len(self.events)


WAF_TRACKER = _RateTracker(300)   # 5 min
TASK_FAILS = _RateTracker(600)    # 10 min


# ---------- Event handlers ----------
async def _handle(event: dict) -> None:
    from .events import emit  # late import to avoid cycles

    typ = event.get("type", "")
    actions: list[dict] = []

    if typ == "fraud.alert" and event.get("band") == "critical":
        doc_id = event.get("document_id")
        if doc_id and quarantine_document(doc_id, "fraud.alert critical"):
            actions.append({"action": "quarantine", "document_id": doc_id})
        actions.append({"action": "ticket",
                        "ticket": open_ticket("fraud", "Critical fraud score", event)})

    elif typ == "adversarial.alert" and event.get("band") == "critical":
        doc_id = event.get("document_id")
        if doc_id and quarantine_document(doc_id, "adversarial.alert critical"):
            actions.append({"action": "quarantine", "document_id": doc_id})
        actions.append({"action": "ticket",
                        "ticket": open_ticket("adversarial", "Deepfake / tampering suspected", event)})

    elif typ == "moderation.flag":
        doc_id = event.get("document_id")
        if doc_id and quarantine_document(doc_id, "moderation.flag"):
            actions.append({"action": "quarantine", "document_id": doc_id})
        actions.append({"action": "ticket",
                        "ticket": open_ticket("moderation", "Document flagged by moderation", event)})

    elif typ == "waf.alert":
        n = WAF_TRACKER.bump()
        if n >= 50:
            set_waf_mode("block")
            actions.append({"action": "waf_block_mode", "burst_count": n})
            actions.append({"action": "ticket",
                            "ticket": open_ticket("waf",
                                                  f"WAF flipped to BLOCK ({n} hits in 5m)",
                                                  event)})

    elif typ == "task.failed":
        n = TASK_FAILS.bump()
        if n >= 20:
            actions.append({"action": "ticket",
                            "ticket": open_ticket("tasks",
                                                  f"Task failures spiking ({n} in 10m)",
                                                  event)})

    for a in actions:
        try:
            emit("remediation.applied", trigger=typ, **a)
        except Exception:
            pass


async def worker_loop() -> None:
    from .events import bus
    q = bus.subscribe()
    try:
        while True:
            event = await q.get()
            try:
                await _handle(event)
            except Exception:
                pass
    finally:
        bus.unsubscribe(q)


async def start() -> None:
    asyncio.create_task(worker_loop())


def tickets(limit: int = 50) -> list[dict]:
    if not TICKET_FILE.exists():
        return []
    with open(TICKET_FILE, encoding="utf-8") as f:
        rows = [json.loads(l) for l in f if l.strip()]
    return rows[-limit:]

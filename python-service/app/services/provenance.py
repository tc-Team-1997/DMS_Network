"""Document provenance chain.

Every lifecycle event (upload, OCR, approval, sign, anchor, replication, integration
call touching the doc) is logged as a ProvenanceEvent. Each event hash-chains to the
previous event for that document, so any tampering (row edit, row delete) breaks
`hash_self == SHA256(payload + hash_prev)`.

Produces a directed graph:
  created → indexed → [approved, signed] → anchored → replicated(eu-central)

Exposed as both a flat timeline (`list_events`) and an adjacency graph
(`lineage`) suitable for visualization with d3/cytoscape.
"""
from __future__ import annotations
import hashlib
import json
import os
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import ProvenanceEvent

REGION = os.environ.get("NBE_REGION", "default")


def _hash(payload: dict, hash_prev: str) -> str:
    body = json.dumps(payload, sort_keys=True, default=str) + (hash_prev or "")
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def record(db: Session, document_id: int, kind: str, *,
           system: str = "nbe-dms", actor: str = "system",
           parent_event_id: Optional[int] = None,
           payload: Optional[dict] = None) -> ProvenanceEvent:
    prev = (
        db.query(ProvenanceEvent)
        .filter(ProvenanceEvent.document_id == document_id)
        .order_by(ProvenanceEvent.id.desc())
        .first()
    )
    hash_prev = prev.hash_self if prev else ("0" * 64)
    payload = payload or {}
    payload_full = {"document_id": document_id, "kind": kind, "system": system,
                    "actor": actor, "region": REGION,
                    "at": datetime.utcnow().isoformat() + "Z", **payload}
    event = ProvenanceEvent(
        document_id=document_id, kind=kind, system=system, actor=actor, region=REGION,
        parent_event_id=parent_event_id or (prev.id if prev else None),
        payload_json=json.dumps(payload_full, default=str)[:8000],
        hash_prev=hash_prev, hash_self=_hash(payload_full, hash_prev),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def list_events(db: Session, document_id: int) -> list[dict]:
    rows = (
        db.query(ProvenanceEvent)
        .filter(ProvenanceEvent.document_id == document_id)
        .order_by(ProvenanceEvent.id.asc()).all()
    )
    return [{
        "id": r.id, "kind": r.kind, "system": r.system, "actor": r.actor,
        "region": r.region, "parent": r.parent_event_id,
        "hash_prev": r.hash_prev, "hash_self": r.hash_self,
        "payload": json.loads(r.payload_json or "{}"),
        "at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]


def verify_chain(db: Session, document_id: int) -> dict:
    events = (
        db.query(ProvenanceEvent)
        .filter(ProvenanceEvent.document_id == document_id)
        .order_by(ProvenanceEvent.id.asc()).all()
    )
    prev_hash = "0" * 64
    broken = []
    for e in events:
        expected = _hash(json.loads(e.payload_json or "{}"), prev_hash)
        if e.hash_prev != prev_hash or e.hash_self != expected:
            broken.append({"event_id": e.id, "kind": e.kind})
        prev_hash = e.hash_self
    return {"document_id": document_id, "events": len(events),
            "tampered": broken, "valid": not broken}


def lineage(db: Session, document_id: int) -> dict:
    events = (
        db.query(ProvenanceEvent)
        .filter(ProvenanceEvent.document_id == document_id)
        .order_by(ProvenanceEvent.id.asc()).all()
    )
    nodes = [{"id": e.id, "label": f"{e.kind}@{e.region}",
              "system": e.system, "actor": e.actor} for e in events]
    edges = [{"source": e.parent_event_id, "target": e.id}
             for e in events if e.parent_event_id]
    return {"document_id": document_id, "nodes": nodes, "edges": edges}

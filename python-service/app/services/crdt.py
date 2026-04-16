"""Active-active conflict resolution.

Each writable region stamps mutations with (region_id, lamport_clock). Two regions
converge deterministically via **last-writer-wins with Lamport ordering** for scalar
fields, and **union / add-wins** for sets (duplicates, workflow steps — append-only).

We store the vector in Document.sync_clock (JSON), e.g. {"eu-west": 42, "eu-central": 17}.
On inbound replication, each field is accepted iff the remote clock tuple > local
tuple under Lamport rules.

This module is storage-agnostic — call `stamp()` before committing a write,
`resolve(local, remote)` when merging an incoming replica event.
"""
from __future__ import annotations
import json
import os
from datetime import datetime
from typing import Any

REGION = os.environ.get("NBE_REGION", "default")


def _parse(clock_json: str | None) -> dict[str, int]:
    try:
        return json.loads(clock_json) if clock_json else {}
    except Exception:
        return {}


def stamp(clock_json: str | None) -> str:
    """Bump this region's counter. Returns the new JSON to persist."""
    vec = _parse(clock_json)
    vec[REGION] = int(vec.get(REGION, 0)) + 1
    return json.dumps(vec)


def lamport_compare(a: str | None, b: str | None) -> int:
    """Return -1/0/1 for a<b, a==b, a>b under Lamport dominance (with tiebreak by max count)."""
    va, vb = _parse(a), _parse(b)
    regions = set(va) | set(vb)
    if not regions:
        return 0
    a_dom = all(va.get(r, 0) >= vb.get(r, 0) for r in regions) and any(va.get(r, 0) > vb.get(r, 0) for r in regions)
    b_dom = all(vb.get(r, 0) >= va.get(r, 0) for r in regions) and any(vb.get(r, 0) > va.get(r, 0) for r in regions)
    if a_dom and not b_dom:
        return 1
    if b_dom and not a_dom:
        return -1
    if a == b:
        return 0
    # Concurrent — tiebreak: higher total wins, then alphabetical region id for determinism.
    sa = sum(va.values()); sb = sum(vb.values())
    if sa != sb:
        return 1 if sa > sb else -1
    return 1 if max(va, default="") > max(vb, default="") else -1


def merge(local: dict[str, Any], remote: dict[str, Any]) -> dict[str, Any]:
    """LWW merge of two document snapshots with `sync_clock` and scalar fields.

    Append-only collections (workflow_steps, duplicate_matches) are expected
    to be reconciled row-by-row at the DB layer (unique ids → union).
    """
    cmp = lamport_compare(local.get("sync_clock"), remote.get("sync_clock"))
    if cmp >= 0:
        # local dominates or equal — keep local scalars, but merge clock
        out = dict(local)
    else:
        out = dict(remote)
    # Always produce the merged clock = elementwise max.
    va = _parse(local.get("sync_clock"))
    vb = _parse(remote.get("sync_clock"))
    merged = {r: max(va.get(r, 0), vb.get(r, 0)) for r in set(va) | set(vb)}
    out["sync_clock"] = json.dumps(merged)
    return out


def merged_timestamp() -> str:
    return datetime.utcnow().isoformat() + "Z"

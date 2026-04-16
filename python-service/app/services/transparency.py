"""Transparency log — hourly Merkle-root publisher.

Builds a Merkle tree over the local ledger journal (services/ledger.py) for the
previous hour and commits the root to:

  - storage/transparency/roots.jsonl  — always, append-only
  - a public transparency endpoint (future: Rekor, Certificate Transparency,
    or a static GitHub Pages repo) when TRANSPARENCY_PUSH_URL is set.

Any party can later:
  1. Download the ledger entries for hour H
  2. Rebuild the Merkle root locally
  3. Fetch the published root for hour H
  4. Verify they match — proving no row was added or altered after the fact.
"""
from __future__ import annotations
import hashlib
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from ..config import settings


ROOTS_DIR = Path(settings.STORAGE_DIR).parent / "transparency"
ROOTS_DIR.mkdir(parents=True, exist_ok=True)
ROOTS_FILE = ROOTS_DIR / "roots.jsonl"

LEDGER_FILE = Path(settings.STORAGE_DIR).parent / "ledger" / "journal.jsonl"

PUSH_URL = os.environ.get("TRANSPARENCY_PUSH_URL", "").strip()
PUSH_TOKEN = os.environ.get("TRANSPARENCY_PUSH_TOKEN", "").strip()


def _h(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _merkle_root(leaves: list[str]) -> str:
    if not leaves:
        return _h(b"")
    level = [_h(leaf.encode()) for leaf in leaves]
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            a = level[i]
            b = level[i + 1] if i + 1 < len(level) else level[i]
            nxt.append(_h((a + b).encode()))
        level = nxt
    return level[0]


def _hour_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    now = now or datetime.utcnow()
    end = now.replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(hours=1)
    return start, end


def _collect(start: datetime, end: datetime) -> list[str]:
    if not LEDGER_FILE.exists():
        return []
    out: list[str] = []
    with open(LEDGER_FILE, encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            ts = rec.get("ts")
            try:
                t = datetime.fromisoformat(ts.rstrip("Z"))
            except Exception:
                continue
            if start <= t < end:
                out.append(rec.get("hash") or "")
    return [h for h in out if h]


def publish(hour_offset: int = 0) -> dict[str, Any]:
    """Publish the Merkle root for `now - hour_offset` hours ago."""
    now = datetime.utcnow() - timedelta(hours=hour_offset)
    start, end = _hour_window(now)
    leaves = _collect(start, end)
    root = _merkle_root(leaves)

    entry = {
        "window_start": start.isoformat() + "Z",
        "window_end": end.isoformat() + "Z",
        "leaf_count": len(leaves),
        "merkle_root": root,
        "published_at": datetime.utcnow().isoformat() + "Z",
    }
    with open(ROOTS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")

    if PUSH_URL:
        try:
            with httpx.Client(timeout=5.0) as c:
                headers = {"Content-Type": "application/json"}
                if PUSH_TOKEN:
                    headers["Authorization"] = f"Bearer {PUSH_TOKEN}"
                r = c.post(PUSH_URL, json=entry, headers=headers)
                entry["pushed"] = 200 <= r.status_code < 300
        except Exception as e:
            entry["pushed"] = False
            entry["push_error"] = str(e)[:120]
    return entry


def verify(hour_start_iso: str) -> dict[str, Any]:
    """Recompute the Merkle root for a given hour and compare against publish log."""
    try:
        start = datetime.fromisoformat(hour_start_iso.rstrip("Z"))
    except Exception:
        return {"ok": False, "reason": "bad_iso"}
    end = start + timedelta(hours=1)
    leaves = _collect(start, end)
    recomputed = _merkle_root(leaves)
    published = None
    if ROOTS_FILE.exists():
        with open(ROOTS_FILE, encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                    if e.get("window_start") == start.isoformat() + "Z":
                        published = e
                        break
                except Exception:
                    continue
    return {
        "window_start": start.isoformat() + "Z",
        "leaf_count": len(leaves),
        "recomputed_root": recomputed,
        "published": published,
        "ok": bool(published) and published["merkle_root"] == recomputed,
    }


def roots(limit: int = 24) -> list[dict]:
    if not ROOTS_FILE.exists():
        return []
    with open(ROOTS_FILE, encoding="utf-8") as f:
        rows = [json.loads(l) for l in f if l.strip()]
    return rows[-limit:]

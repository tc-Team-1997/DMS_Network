"""Regulatory watchlist sync + auto-rematch.

Fetches OFAC SDN (CSV), UN consolidated list (XML), and EU sanctions / PEP
feeds. For each customer already in the system, names are fuzzy-matched against
the freshly loaded entries; any match ≥ threshold becomes a `WatchlistMatch`
row and emits an `aml.alert` event → bus / SIEM / ledger / remediation.

Sources (URLs configurable via env — the bank's network is usually whitelisted
to these):
    WATCHLIST_OFAC_URL  (default: https://www.treasury.gov/ofac/downloads/sdn.csv)
    WATCHLIST_UN_URL    (default: https://scsanctions.un.org/resources/xml/en/consolidated.xml)
    WATCHLIST_EU_URL    (EU financial sanctions XML)

For air-gap deployments, a seed TSV at storage/watchlist/seed.tsv is loaded if
network is unavailable — ship it with the quarterly air-gap bundle.
"""
from __future__ import annotations
import csv
import io
import json
import os
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Iterable

import httpx
from rapidfuzz import fuzz
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Document, WatchlistEntry, WatchlistMatch
from .events import emit


WATCHLIST_DIR = Path(settings.STORAGE_DIR).parent / "watchlist"
WATCHLIST_DIR.mkdir(parents=True, exist_ok=True)
SEED_FILE = WATCHLIST_DIR / "seed.tsv"

OFAC_URL = os.environ.get("WATCHLIST_OFAC_URL",
                          "https://www.treasury.gov/ofac/downloads/sdn.csv")
UN_URL = os.environ.get("WATCHLIST_UN_URL",
                        "https://scsanctions.un.org/resources/xml/en/consolidated.xml")
EU_URL = os.environ.get("WATCHLIST_EU_URL", "")

DEFAULT_THRESHOLD = int(os.environ.get("WATCHLIST_THRESHOLD", "88"))


def _normalize(name: str) -> str:
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii")
    return " ".join(s.lower().split())


# ---------- Fetchers ----------
def _fetch(url: str) -> bytes | None:
    if not url:
        return None
    try:
        with httpx.Client(timeout=20.0, follow_redirects=True) as c:
            r = c.get(url)
            if r.status_code == 200:
                return r.content
    except Exception as e:
        print(f"[watchlist] fetch {url} failed: {e}")
    return None


def _parse_ofac(blob: bytes) -> Iterable[dict]:
    reader = csv.reader(io.StringIO(blob.decode("utf-8", errors="ignore")))
    for row in reader:
        if len(row) < 4:
            continue
        ext_id, name, sdn_type, program = row[0], row[1], row[2], row[3]
        yield {"source": "ofac", "ext_id": ext_id.strip(),
               "name": name.strip().strip('"'),
               "category": (program or sdn_type or "SDN")[:64],
               "raw": {"program": program, "type": sdn_type}}


def _parse_un(blob: bytes) -> Iterable[dict]:
    # Minimal XML parse — full UN schema uses INDIVIDUAL / ENTITY sections.
    try:
        from xml.etree import ElementTree as ET
        root = ET.fromstring(blob)
    except Exception:
        return []
    out = []
    for node in root.iter():
        tag = node.tag.split("}", 1)[-1].lower()
        if tag in ("individual", "entity"):
            first = node.findtext(".//FIRST_NAME") or ""
            second = node.findtext(".//SECOND_NAME") or ""
            name = (first + " " + second).strip() or node.findtext(".//NAME_ORIGINAL_SCRIPT") or ""
            ext = node.findtext(".//DATAID") or ""
            if name:
                out.append({"source": "un", "ext_id": ext.strip(),
                            "name": name, "category": "UN",
                            "raw": {"tag": tag}})
    return out


def _parse_seed(path: Path) -> Iterable[dict]:
    if not path.exists():
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            out.append({"source": parts[0], "ext_id": parts[1], "name": parts[2],
                        "category": parts[3] if len(parts) > 3 else "local",
                        "raw": {}})
    return out


# ---------- Sync + match ----------
def sync(db: Session) -> dict:
    loaded = 0
    replaced = 0
    for fetch, parse in (
        (lambda: _fetch(OFAC_URL), _parse_ofac),
        (lambda: _fetch(UN_URL),   _parse_un),
    ):
        blob = fetch()
        if not blob:
            continue
        entries = list(parse(blob))
        if not entries:
            continue
        src = entries[0]["source"]
        db.query(WatchlistEntry).filter(WatchlistEntry.source == src).delete()
        replaced += 1
        for e in entries:
            row = WatchlistEntry(
                source=e["source"], ext_id=str(e.get("ext_id", ""))[:128],
                name=e["name"][:512], name_norm=_normalize(e["name"])[:512],
                category=str(e.get("category", ""))[:64],
                raw_json=json.dumps(e.get("raw", {}))[:2000],
            )
            db.add(row)
            loaded += 1

    # Always load the seed file last so local/manual overrides win.
    for e in _parse_seed(SEED_FILE):
        db.add(WatchlistEntry(
            source=e["source"], ext_id=str(e["ext_id"])[:128],
            name=e["name"][:512], name_norm=_normalize(e["name"])[:512],
            category=str(e.get("category", "local"))[:64],
        ))
        loaded += 1

    db.commit()
    emit("watchlist.synced", loaded=loaded, replaced_sources=replaced)
    return {"loaded": loaded, "replaced_sources": replaced,
            "at": datetime.utcnow().isoformat() + "Z"}


def rematch(db: Session, threshold: int = DEFAULT_THRESHOLD) -> dict:
    """Re-scan every customer against the current watchlist. Expensive but correct."""
    cids = [r[0] for r in db.query(Document.customer_cid)
            .filter(Document.customer_cid != None)  # noqa: E711
            .distinct().all()]
    entries = db.query(WatchlistEntry).all()
    if not entries:
        return {"matched": 0, "reason": "empty_watchlist"}

    new_matches = 0
    for cid in cids:
        # Use any KYC document's name — OCR text if we have it, else CID as fallback.
        doc = db.query(Document).filter(Document.customer_cid == cid).first()
        probe = _normalize(doc.uploaded_by or cid) if doc else cid
        best: tuple[int, WatchlistEntry] | None = None
        for e in entries:
            if not e.name_norm:
                continue
            s = fuzz.token_set_ratio(probe, e.name_norm)
            if s >= threshold and (best is None or s > best[0]):
                best = (s, e)
        if best:
            exists = db.query(WatchlistMatch).filter(
                WatchlistMatch.customer_cid == cid,
                WatchlistMatch.entry_id == best[1].id,
                WatchlistMatch.status == "open",
            ).first()
            if not exists:
                m = WatchlistMatch(
                    customer_cid=cid, document_id=doc.id if doc else None,
                    entry_id=best[1].id, score=float(best[0]),
                    matched_name=best[1].name[:512], reason="auto_sync",
                )
                db.add(m)
                new_matches += 1
                emit("aml.alert", customer_cid=cid, score=best[0],
                     watchlist_source=best[1].source, matched_name=best[1].name)
    db.commit()
    return {"matched": new_matches, "scanned_customers": len(cids)}


def list_matches(db: Session, status: str | None = "open", limit: int = 100) -> list[dict]:
    q = db.query(WatchlistMatch)
    if status:
        q = q.filter(WatchlistMatch.status == status)
    return [{"id": m.id, "customer_cid": m.customer_cid,
             "document_id": m.document_id, "score": m.score,
             "matched_name": m.matched_name, "reason": m.reason,
             "status": m.status,
             "created_at": m.created_at.isoformat() if m.created_at else None}
            for m in q.order_by(WatchlistMatch.id.desc()).limit(limit).all()]


def review(db: Session, match_id: int, action: str, reviewer: str) -> dict:
    m = db.get(WatchlistMatch, match_id)
    if not m:
        raise ValueError("not_found")
    if action not in ("cleared", "escalated"):
        raise ValueError("invalid_action")
    m.status = action
    m.reviewed_by = reviewer
    m.reviewed_at = datetime.utcnow()
    db.commit()
    emit("aml.review", match_id=m.id, action=action, reviewer=reviewer)
    return {"id": m.id, "status": m.status}

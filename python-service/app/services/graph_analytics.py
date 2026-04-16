"""Customer graph analytics.

Builds a related-party graph from document metadata + OCR extractions:
  - Nodes: customer CIDs
  - Edges:
      * SAME_BRANCH + >=3 submissions in 30 days   (low-signal)
      * SHARED_DUPLICATE_DOC (via DuplicateMatch)  (high-signal)
      * SAME_UPLOADED_BY across >2 CIDs            (staff-coordinated)
      * OCR_OVERLAP — top-k tokens shared across customers (heuristic KYC clone)
  - Ring detection: find cycles of length 3-5 among high-signal edges.

This is a heuristic, not a production graph DB; for million-doc portfolios
move to Neo4j / Amazon Neptune and replay the same edge semantics via their
graph query language.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Document, DuplicateMatch, OcrResult


def _shared_duplicates(db: Session, tenant: str) -> list[tuple[str, str, str]]:
    q = (
        db.query(DuplicateMatch, Document)
        .join(Document, Document.id == DuplicateMatch.doc_a)
        .filter(Document.tenant == tenant)
    )
    # Resolve both endpoints to CIDs.
    edges: list[tuple[str, str, str]] = []
    for m, doc_a in q.all():
        doc_b = db.get(Document, m.doc_b)
        if not (doc_a.customer_cid and doc_b and doc_b.customer_cid):
            continue
        if doc_a.customer_cid == doc_b.customer_cid:
            continue
        edges.append((doc_a.customer_cid, doc_b.customer_cid, m.match_type or "duplicate"))
    return edges


def _same_uploader(db: Session, tenant: str, min_cids: int = 3) -> list[tuple[str, str, str]]:
    # Uploaders that touched >= min_cids distinct CIDs → pair up those CIDs.
    rows = (
        db.query(Document.uploaded_by, Document.customer_cid)
        .filter(Document.tenant == tenant,
                Document.uploaded_by != None,  # noqa: E711
                Document.customer_cid != None)  # noqa: E711
        .all()
    )
    by_user = defaultdict(set)
    for user, cid in rows:
        by_user[user].add(cid)
    edges: list[tuple[str, str, str]] = []
    for user, cids in by_user.items():
        if len(cids) < min_cids:
            continue
        c = sorted(cids)
        for i in range(len(c)):
            for j in range(i + 1, len(c)):
                edges.append((c[i], c[j], f"uploader:{user}"))
    return edges


def _ocr_overlap(db: Session, tenant: str, threshold: int = 8) -> list[tuple[str, str, str]]:
    # Cheap shared-token hash: pick top-k rare tokens per customer and intersect pairs.
    rows = (
        db.query(Document.customer_cid, OcrResult.text)
        .join(OcrResult, OcrResult.document_id == Document.id)
        .filter(Document.tenant == tenant, Document.customer_cid != None)  # noqa: E711
        .all()
    )
    cust_tokens: dict[str, set[str]] = defaultdict(set)
    for cid, text in rows:
        if not text:
            continue
        # token = long alphabetic fragments, lowercased; filter numerics to reduce noise
        toks = {w.lower() for w in (text or "").split() if len(w) >= 6 and any(c.isalpha() for c in w)}
        cust_tokens[cid].update(list(toks)[:200])  # cap per customer

    cids = sorted(cust_tokens.keys())
    edges: list[tuple[str, str, str]] = []
    for i in range(len(cids)):
        for j in range(i + 1, len(cids)):
            inter = cust_tokens[cids[i]] & cust_tokens[cids[j]]
            if len(inter) >= threshold:
                edges.append((cids[i], cids[j], f"ocr_overlap:{len(inter)}"))
    return edges


def build_graph(db: Session, tenant: str = "default") -> dict[str, Any]:
    edges = []
    edges += [(a, b, t, 10) for (a, b, t) in _shared_duplicates(db, tenant)]
    edges += [(a, b, t, 6)  for (a, b, t) in _same_uploader(db, tenant)]
    edges += [(a, b, t, 4)  for (a, b, t) in _ocr_overlap(db, tenant)]

    node_set = set()
    for a, b, _, _ in edges:
        node_set.add(a); node_set.add(b)

    return {
        "tenant": tenant,
        "nodes": [{"id": n} for n in sorted(node_set)],
        "edges": [{"source": a, "target": b, "type": t, "weight": w}
                  for a, b, t, w in edges],
    }


def find_rings(db: Session, tenant: str = "default", min_weight: int = 6,
               max_cycle_len: int = 5) -> list[list[str]]:
    """Return simple cycles of high-signal edges (possible fraud rings)."""
    g = build_graph(db, tenant)
    adj: dict[str, set[str]] = defaultdict(set)
    for e in g["edges"]:
        if e["weight"] < min_weight:
            continue
        adj[e["source"]].add(e["target"])
        adj[e["target"]].add(e["source"])

    rings: list[list[str]] = []
    seen: set[frozenset] = set()

    def dfs(start: str, node: str, path: list[str], depth: int):
        if depth > max_cycle_len:
            return
        for nxt in adj[node]:
            if nxt == start and len(path) >= 3:
                key = frozenset(path)
                if key not in seen:
                    seen.add(key)
                    rings.append(list(path))
            elif nxt not in path and depth < max_cycle_len:
                dfs(start, nxt, path + [nxt], depth + 1)

    for n in adj:
        dfs(n, n, [n], 1)
    return rings


def neighbors(db: Session, customer_cid: str, tenant: str = "default",
              depth: int = 2) -> dict[str, Any]:
    g = build_graph(db, tenant)
    adj: dict[str, list[dict]] = defaultdict(list)
    for e in g["edges"]:
        adj[e["source"]].append({"cid": e["target"], "type": e["type"], "weight": e["weight"]})
        adj[e["target"]].append({"cid": e["source"], "type": e["type"], "weight": e["weight"]})

    seen = {customer_cid: 0}
    frontier = [customer_cid]
    for d in range(1, depth + 1):
        nxt = []
        for node in frontier:
            for n in adj.get(node, []):
                if n["cid"] not in seen:
                    seen[n["cid"]] = d
                    nxt.append(n["cid"])
        frontier = nxt
    return {"center": customer_cid, "depth": depth,
            "nodes": [{"cid": c, "distance": d} for c, d in seen.items()]}

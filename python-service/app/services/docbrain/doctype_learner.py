"""DocType Learner — infer document-type schemas from samples.

Supports:
    infer_schema(samples)      — OCR + classify + extract over 3-10 samples,
                                  aggregate into a proposed InferredSchema with
                                  an optional second LLM pass for extra fields.
    embed_samples(schema_id, sample_ids, db)
                               — chunk + embed each sample's ocr_text into
                                 doctype_sample_chunks for nearest-schema search.
    nearest_schemas(text, top_k=3)
                               — cosine similarity against all indexed chunks,
                                 grouped by schema_id, returns top_k matches.

All LLM calls use temperature=0.0 (deterministic JSON mode).
"""
from __future__ import annotations

import json
import logging
import math
import os
import struct
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Union

import numpy as np

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Canonical extract keys — the 8 fields DocBrain knows how to pull.
# Any field outside this set must have ai_extract_from=None.
# ---------------------------------------------------------------------------

_CANONICAL_KEYS = frozenset({
    "customer_cid",
    "customer_name",
    "doc_number",
    "dob",
    "issue_date",
    "expiry_date",
    "issuing_authority",
    "address",
})

_FIELD_TYPES = frozenset({"text", "date", "number", "email", "tel", "textarea"})

# Map canonical key names to sensible default types.
_CANONICAL_TYPE_MAP: Dict[str, str] = {
    "customer_cid":      "text",
    "customer_name":     "text",
    "doc_number":        "text",
    "dob":               "date",
    "issue_date":        "date",
    "expiry_date":       "date",
    "issuing_authority": "text",
    "address":           "textarea",
}

# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass
class SampleInput:
    """One raw sample document."""
    filename: str
    bytes_: bytes
    mime_type: str


@dataclass
class InferredField:
    key: str
    label: str
    type: str                            # text|date|number|email|tel|textarea
    required: bool
    ai_extract_from: Optional[str]       # one of _CANONICAL_KEYS or None
    seen_in: int                         # how many samples had this field non-null
    total_samples: int


@dataclass
class PerSampleReport:
    filename: str
    ocr_preview: str
    ocr_backend: str
    ocr_mean_confidence: float
    extracted_fields: Dict[str, Any]


@dataclass
class InferredSchema:
    name: str
    description: str
    fields: List[InferredField]
    confidence: float
    per_sample: List[PerSampleReport]


@dataclass
class SchemaMatch:
    schema_id: int
    name: str
    similarity: float


# ---------------------------------------------------------------------------
# Chunking constants (match the task spec: 500-char windows, 50-char overlap)
# ---------------------------------------------------------------------------

_CHUNK_SIZE = 500
_CHUNK_OVERLAP = 50


def _chunk_text(text: str) -> List[str]:
    """Sliding-window character chunker."""
    if not text:
        return []
    step = max(1, _CHUNK_SIZE - _CHUNK_OVERLAP)
    chunks: List[str] = []
    for start in range(0, len(text), step):
        piece = text[start:start + _CHUNK_SIZE].strip()
        if piece:
            chunks.append(piece)
    return chunks


# ---------------------------------------------------------------------------
# Schema-merge prompt for the second LLM pass
# ---------------------------------------------------------------------------

_SCHEMA_MERGE_PROMPT = """You are DocBrain, a document-schema designer for banking KYC.

You are given:
  - A proposed document type name: {doc_class}
  - A combined OCR text from {n} sample documents (truncated to first 6000 chars per sample)

Identify fields that appear consistently in these documents but are NOT in the
standard set:
  customer_cid, customer_name, doc_number, dob, issue_date, expiry_date,
  issuing_authority, address

For each additional field you find:
  - key:      a snake_case machine identifier (e.g. "blood_group", "place_of_birth")
  - label:    a human-readable label (e.g. "Blood Group", "Place of Birth")
  - type:     one of: text, date, number, email, tel, textarea
  - required: true if the field appears in every sample, false otherwise

Return a JSON object:
  {{"extra_fields": [ {{"key": "...", "label": "...", "type": "...", "required": true/false}}, ... ] }}

If you find no extra fields, return {{"extra_fields": []}}.
Do NOT re-list the 8 canonical fields above.
"""


# ---------------------------------------------------------------------------
# infer_schema
# ---------------------------------------------------------------------------

def infer_schema(samples: Union[List[SampleInput], List[Dict[str, Any]]]) -> Dict[str, Any]:
    """
    Run OCR + classify + extract over 3-10 samples; aggregate into a
    proposed schema. Returns a dict (for easy JSON serialisation) matching
    the shape the router proxies to the SPA.

    Accepts either:
      - list[SampleInput]                — the canonical typed form
      - list[dict] with keys "data", "mime_type", "filename"
        (the shape the doctypes.py router produces)
    """
    from .ocr import ocr_document
    from .classify import classify_document
    from .extract import extract_entities
    from .llm import chat_json

    # Normalise input to a consistent internal form.
    _samples: List[Dict[str, Any]] = []
    for s in samples:
        if isinstance(s, SampleInput):
            _samples.append({
                "data":      s.bytes_,
                "mime_type": s.mime_type,
                "filename":  s.filename,
            })
        else:
            _samples.append(s)

    n = len(_samples)

    # Per-sample OCR + classify + extract.
    per_sample_reports: List[PerSampleReport] = []
    class_votes: List[str] = []
    confidence_votes: List[float] = []
    # key → count of samples where that key had a non-null value
    key_seen: Dict[str, int] = {k: 0 for k in _CANONICAL_KEYS}
    ocr_texts: List[str] = []

    t0 = time.monotonic()

    for s in _samples:
        data     = s.get("data") or s.get("bytes_") or b""
        mime     = s.get("mime_type", "application/octet-stream")
        filename = s.get("filename", "sample")

        # OCR
        try:
            ocr_res = ocr_document(data, mime)
        except Exception as exc:  # noqa: BLE001
            log.warning("infer_schema: OCR failed for %s: %s", filename, exc)
            ocr_res = _empty_ocr_result(filename)

        ocr_text = (ocr_res.full_text or "").strip()
        ocr_texts.append(ocr_text)

        # Classify
        try:
            cls_result = classify_document(ocr_text)
            if cls_result.doc_class and cls_result.doc_class != "Unknown":
                class_votes.append(cls_result.doc_class)
                confidence_votes.append(cls_result.confidence)
        except Exception as exc:  # noqa: BLE001
            log.warning("infer_schema: classify failed for %s: %s", filename, exc)

        # Extract
        try:
            ext_result = extract_entities(ocr_text)
        except Exception as exc:  # noqa: BLE001
            log.warning("infer_schema: extract failed for %s: %s", filename, exc)
            ext_result = None

        extracted: Dict[str, Any] = {}
        if ext_result is not None:
            for key in _CANONICAL_KEYS:
                ef = getattr(ext_result, key, None)
                val = getattr(ef, "value", None) if ef is not None else None
                if val:
                    key_seen[key] = key_seen.get(key, 0) + 1
                    extracted[key] = val

        per_sample_reports.append(PerSampleReport(
            filename=filename,
            ocr_preview=ocr_text[:400],
            ocr_backend=getattr(ocr_res, "backend", "tesseract"),
            ocr_mean_confidence=float(getattr(ocr_res, "mean_confidence", 0.0)),
            extracted_fields=extracted,
        ))

    latency_ms = round((time.monotonic() - t0) * 1000)
    log.info(
        '{"op": "infer_schema", "latency_ms": %d, "n_samples": %d}',
        latency_ms, n,
    )

    # Majority-vote the doc class.
    doc_class = "Unknown"
    mean_confidence = 0.0
    if class_votes:
        from collections import Counter
        most_common, _ = Counter(class_votes).most_common(1)[0]
        doc_class = most_common
        mean_confidence = sum(confidence_votes) / len(confidence_votes)

    # Build canonical InferredFields (≥80% rule for required).
    fields: List[InferredField] = []
    for key in _CANONICAL_KEYS:
        seen = key_seen.get(key, 0)
        if seen == 0:
            continue
        required = (seen / n) >= 0.8
        fields.append(InferredField(
            key=key,
            label=_label_for(key),
            type=_CANONICAL_TYPE_MAP.get(key, "text"),
            required=required,
            ai_extract_from=key,
            seen_in=seen,
            total_samples=n,
        ))

    # Second LLM pass — discover non-canonical fields from the OCR text.
    combined_ocr = "\n\n---\n\n".join(t[:6000] for t in ocr_texts)
    extra_fields = _discover_extra_fields(doc_class, combined_ocr, n, chat_json)
    for ef in extra_fields:
        fields.append(ef)

    schema = InferredSchema(
        name=doc_class,
        description=f"Inferred from {n} sample document(s).",
        fields=fields,
        confidence=round(mean_confidence, 3),
        per_sample=per_sample_reports,
    )

    # Flat shape matching the SPA's InferResponseSchema.
    return {
        "name":        schema.name,
        "description": schema.description,
        "fields": [
            {
                "key":              f.key,
                "label":            f.label,
                "type":             f.type,
                "required":         f.required,
                "ai_extract_from":  f.ai_extract_from,
                "seen_in_samples":  f.seen_in,
                "total_samples":    f.total_samples,
            }
            for f in schema.fields
        ],
        "confidence":   schema.confidence,
        "total_samples": n,
        "per_sample": [
            {
                "filename":             r.filename,
                "ocr_preview":          r.ocr_preview,
                "ocr_backend":          r.ocr_backend,
                "ocr_mean_confidence":  r.ocr_mean_confidence,
                "extracted_fields":     r.extracted_fields,
            }
            for r in schema.per_sample
        ],
    }


def _label_for(key: str) -> str:
    """Human-readable label for a canonical key."""
    return {
        "customer_cid":      "Customer / Citizen ID",
        "customer_name":     "Full Name",
        "doc_number":        "Document Number",
        "dob":               "Date of Birth",
        "issue_date":        "Issue Date",
        "expiry_date":       "Expiry Date",
        "issuing_authority": "Issuing Authority",
        "address":           "Address",
    }.get(key, key.replace("_", " ").title())


def _discover_extra_fields(
    doc_class: str,
    combined_ocr: str,
    n: int,
    chat_json_fn: Any,
) -> List[InferredField]:
    """Ask the LLM to propose non-canonical fields from the aggregated OCR text."""
    system = _SCHEMA_MERGE_PROMPT.format(doc_class=doc_class, n=n)
    try:
        reply = chat_json_fn(system, combined_ocr[:8000], temperature=0.0)
    except Exception as exc:  # noqa: BLE001
        log.warning("infer_schema: extra-field LLM pass failed: %s", exc)
        return []

    extras = reply.get("extra_fields", [])
    if not isinstance(extras, list):
        return []

    result: List[InferredField] = []
    for item in extras:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", "")).strip()
        if not key or key in _CANONICAL_KEYS:
            # Do not re-introduce canonical keys via this path.
            continue
        ftype = str(item.get("type", "text"))
        if ftype not in _FIELD_TYPES:
            ftype = "text"
        result.append(InferredField(
            key=key,
            label=str(item.get("label", key.replace("_", " ").title())),
            type=ftype,
            required=bool(item.get("required", False)),
            ai_extract_from=None,      # non-canonical → no auto-extract mapping
            seen_in=n if item.get("required") else 0,
            total_samples=n,
        ))
    return result


# ---------------------------------------------------------------------------
# embed_samples
# ---------------------------------------------------------------------------

_CHUNKS_DDL = """
CREATE TABLE IF NOT EXISTS doctype_sample_chunks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id    INTEGER NOT NULL,
    chunk_index  INTEGER NOT NULL,
    text         TEXT NOT NULL,
    embedding    BLOB NOT NULL,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sample_id, chunk_index)
)
"""


def _ensure_chunks_table(db) -> None:
    """Create doctype_sample_chunks if it doesn't exist yet (graceful degradation)."""
    if db is None:
        return
    try:
        from sqlalchemy.orm import Session as SASession
        if isinstance(db, SASession):
            from sqlalchemy import text as satext
            db.execute(satext(_CHUNKS_DDL))
            db.commit()
            return
    except ImportError:
        pass
    import re
    positional, values = _sa_to_qmark(_CHUNKS_DDL, {})
    db.execute(positional)


def embed_samples(
    schema_id: int,
    samples: Union[List[Dict[str, Any]], List[int]],
    *,
    db=None,
    sample_ids: Optional[List[int]] = None,
    remove_sha256: Optional[str] = None,
) -> int:
    """
    Chunk + embed OCR text for each sample, write into doctype_sample_chunks.
    Idempotent: deletes existing chunks for the affected sample IDs first.

    Accepts two call patterns:

    Pattern A (router commits / reindex — passes raw payloads):
        embed_samples(schema_id, samples=[{"data": ..., "mime_type": ..., "sha256": ...}, ...])
        OCR is run on-the-fly if ocr_text is not already in the payload.

    Pattern B (router delete — remove chunks for a single sha256):
        embed_samples(schema_id, samples=[], remove_sha256="<hash>")

    Returns the total number of chunk rows written.
    """
    from .embed import embed_text, EMBED_DIM

    # Lazily acquire the DB connection. Supports both SQLAlchemy Sessions
    # (passed by the router) and raw sqlite3 connections (tests).
    _db_conn = db  # may be None; resolved below

    _ensure_chunks_table(_db_conn)

    if remove_sha256:
        # Removal mode: delete chunks for the given sha256.
        _exec_sql(
            _db_conn,
            "DELETE FROM doctype_sample_chunks WHERE sample_id IN "
            "(SELECT id FROM document_type_samples WHERE sha256 = :sha256)",
            {"sha256": remove_sha256},
        )
        return 0

    if not samples:
        return 0

    total_written = 0

    for s in samples:
        if not isinstance(s, dict):
            continue

        sha256 = s.get("sha256", "")
        data   = s.get("data") or b""
        mime   = s.get("mime_type", "application/octet-stream")
        ocr_text: str = s.get("ocr_text") or ""

        # If ocr_text not pre-supplied, run OCR now.
        if not ocr_text and data:
            try:
                from .ocr import ocr_document
                ocr_res = ocr_document(data, mime)
                ocr_text = (ocr_res.full_text or "").strip()
            except Exception as exc:  # noqa: BLE001
                log.warning("embed_samples: OCR failed for sha256=%s: %s", sha256, exc)
                ocr_text = ""

        if not ocr_text:
            continue

        # Resolve sample_id from DB.
        sample_id = _resolve_sample_id(_db_conn, schema_id, sha256)
        if sample_id is None:
            log.warning("embed_samples: sample not found for sha256=%s schema=%d", sha256, schema_id)
            continue

        # Delete stale chunks for this sample.
        _exec_sql(
            _db_conn,
            "DELETE FROM doctype_sample_chunks WHERE sample_id = :sid",
            {"sid": sample_id},
        )

        # Chunk the OCR text.
        chunks = _chunk_text(ocr_text)
        if not chunks:
            continue

        t0 = time.monotonic()
        written = 0
        for idx, chunk in enumerate(chunks):
            vec = embed_text(chunk)
            if not vec or len(vec) != EMBED_DIM:
                log.warning(
                    "embed_samples: bad embedding for sample %d chunk %d "
                    "(got %d dims, expected %d)",
                    sample_id, idx, len(vec) if vec else 0, EMBED_DIM,
                )
                continue
            blob = _encode_vec(vec)
            _exec_sql(
                _db_conn,
                "INSERT INTO doctype_sample_chunks "
                "(sample_id, chunk_index, text, embedding) "
                "VALUES (:sid, :idx, :text, :emb)",
                {"sid": sample_id, "idx": idx, "text": chunk, "emb": blob},
            )
            written += 1

        latency_ms = round((time.monotonic() - t0) * 1000)
        log.info(
            '{"op": "embed_samples", "schema_id": %d, "sample_id": %d, '
            '"chunks": %d, "latency_ms": %d}',
            schema_id, sample_id, written, latency_ms,
        )
        total_written += written

    return total_written


# ---------------------------------------------------------------------------
# nearest_schemas
# ---------------------------------------------------------------------------

def nearest_schemas(text: str, top_k: int = 3) -> List[Dict[str, Any]]:
    """
    Embed `text`, cosine-similarity against all doctype_sample_chunks rows,
    group by schema_id (via document_type_samples join), return top_k by
    max-chunk similarity.

    Returns a list of dicts: [{"schema_id": int, "name": str, "similarity": float}, ...]
    """
    from .embed import embed_text, EMBED_DIM

    if not text or not text.strip():
        return []

    t0 = time.monotonic()
    qvec = embed_text(text.strip())
    if not qvec or len(qvec) != EMBED_DIM:
        log.warning("nearest_schemas: empty or bad-dim query embedding")
        return []

    q = np.array(qvec, dtype="<f4")
    q_norm = q / (np.linalg.norm(q) + 1e-12)

    # Load all chunks with their schema_id.
    rows = _fetch_all(
        None,  # uses fallback SQLite connection
        "SELECT dsc.embedding, dts.schema_id, dts2.name "
        "FROM doctype_sample_chunks dsc "
        "JOIN document_type_samples dts ON dts.id = dsc.sample_id "
        "JOIN document_type_schemas dts2 ON dts2.id = dts.schema_id",
        {},
    )

    if not rows:
        latency_ms = round((time.monotonic() - t0) * 1000)
        log.info('{"op": "nearest_schemas", "latency_ms": %d, "rows": 0}', latency_ms)
        return []

    # Build matrix and compute cosine similarities.
    emb_list = []
    schema_ids = []
    names = []
    for blob, sid, name in rows:
        emb_list.append(_decode_vec(blob))
        schema_ids.append(int(sid))
        names.append(str(name))

    embs = np.vstack(emb_list).astype("<f4")
    norms = np.linalg.norm(embs, axis=1) + 1e-12
    embs_norm = embs / norms[:, None]
    sims = embs_norm @ q_norm  # shape: (N,)

    # Group by schema_id — take the max similarity per schema.
    best: Dict[int, float] = {}
    best_name: Dict[int, str] = {}
    for i, (sid, name) in enumerate(zip(schema_ids, names)):
        sim = float(sims[i])
        if sid not in best or sim > best[sid]:
            best[sid] = sim
            best_name[sid] = name

    # Sort by descending similarity, take top_k.
    ranked = sorted(best.items(), key=lambda x: x[1], reverse=True)[:top_k]

    latency_ms = round((time.monotonic() - t0) * 1000)
    log.info(
        '{"op": "nearest_schemas", "top_k": %d, "latency_ms": %d, '
        '"candidates": %d}',
        top_k, latency_ms, len(best),
    )

    return [
        {"schema_id": sid, "name": best_name[sid], "similarity": round(sim, 4)}
        for sid, sim in ranked
    ]


# ---------------------------------------------------------------------------
# Internal DB helpers — abstract over SQLAlchemy Session vs raw sqlite3
# ---------------------------------------------------------------------------

def _get_fallback_db():
    """Open a raw sqlite3 connection to the docbrain DB for read-only queries."""
    import sqlite3
    from pathlib import Path

    db_path = Path(os.environ.get("DOCBRAIN_DB", "./storage/docbrain.sqlite"))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _exec_sql(db, sql: str, params: Dict[str, Any]) -> None:
    """Execute a write statement on either an SQLAlchemy Session or sqlite3 conn."""
    if db is None:
        return  # nothing to write without a DB handle
    try:
        from sqlalchemy.orm import Session as SASession
        if isinstance(db, SASession):
            from sqlalchemy import text as satext
            db.execute(satext(sql), params)
            db.commit()
            return
    except ImportError:
        pass
    # Raw sqlite3 connection.
    import sqlite3
    cursor = db.cursor() if hasattr(db, "cursor") else None
    if cursor is not None:
        # Convert :name params to ?-style for sqlite3.
        import re
        positional, values = _sa_to_qmark(sql, params)
        db.execute(positional, values)


def _fetch_all(db, sql: str, params: Dict[str, Any]) -> List[tuple]:
    """Execute a read query; falls back to the docbrain SQLite DB if db is None."""
    _conn = db
    close_after = False
    if _conn is None:
        _conn = _get_fallback_db()
        close_after = True
    try:
        from sqlalchemy.orm import Session as SASession
        if isinstance(_conn, SASession):
            from sqlalchemy import text as satext
            rows = _conn.execute(satext(sql), params).fetchall()
            return list(rows)
    except ImportError:
        pass
    # sqlite3
    import re
    positional, values = _sa_to_qmark(sql, params)
    rows = _conn.execute(positional, values).fetchall()
    if close_after:
        _conn.close()
    return rows


def _resolve_sample_id(db, schema_id: int, sha256: str) -> Optional[int]:
    """Look up document_type_samples.id by (schema_id, sha256)."""
    rows = _fetch_all(
        db,
        "SELECT id FROM document_type_samples WHERE schema_id=:sid AND sha256=:sha",
        {"sid": schema_id, "sha": sha256},
    )
    if rows:
        return int(rows[0][0])
    return None


def _sa_to_qmark(sql: str, params: Dict[str, Any]):
    """Convert :name-style params to ?-style for sqlite3."""
    import re
    keys: List[str] = []
    def _replace(m):
        keys.append(m.group(1))
        return "?"
    positional = re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", _replace, sql)
    values = [params[k] for k in keys]
    return positional, values


# ---------------------------------------------------------------------------
# Vector encoding helpers
# ---------------------------------------------------------------------------

def _encode_vec(vec: List[float]) -> bytes:
    """Pack a list of float32 into a BLOB."""
    return struct.pack(f"{len(vec)}f", *vec)


def _decode_vec(blob: bytes) -> np.ndarray:
    """Unpack a BLOB into a float32 ndarray."""
    n = len(blob) // 4
    return np.frombuffer(blob, dtype="<f4", count=n).copy()


# ---------------------------------------------------------------------------
# Fallback OCR result when Tesseract is unavailable
# ---------------------------------------------------------------------------

def _empty_ocr_result(filename: str):
    """Return a stub OcrResult-like object with empty text."""
    class _Stub:
        full_text = ""
        mean_confidence = 0.0
        backend = "unavailable"
        pages = []
        languages = []
    return _Stub()

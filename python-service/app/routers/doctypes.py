"""
DocTypes router — "learn document types from samples" feature.

Endpoints:
    POST   /api/v1/docbrain/doctypes/infer
    POST   /api/v1/docbrain/doctypes/commit
    GET    /api/v1/docbrain/doctypes/{schema_id}/samples
    GET    /api/v1/docbrain/doctypes/{schema_id}/samples/{sample_id}
    DELETE /api/v1/docbrain/doctypes/{schema_id}/samples/{sample_id}
    POST   /api/v1/docbrain/doctypes/{schema_id}/reindex
    POST   /api/v1/docbrain/doctypes/classify-one
    POST   /api/v1/docbrain/doctypes/{schema_id}/tamper-check

Service deps (provided by docbrain-ai-engineer):
    app.services.docbrain.doctype_learner: infer_schema, embed_samples, nearest_schemas
    app.services.docbrain.tamper:          check_tamper, baseline_fingerprint

Storage: STORAGE_DIR/doctype_samples/<schema_id>/<sha256>.<ext>
DB tables: document_type_schemas, document_type_samples  (migrated by db-migrator)
"""
from __future__ import annotations

import base64
import hashlib
import io
import logging
import mimetypes
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text as sqltext
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..security import require_api_key

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level references to docbrain functions used inside endpoints.
# Defined at import time so monkeypatch can replace them in tests.
# Fall back to a no-op sentinel so the module always imports cleanly even
# when Tesseract / Poppler are absent (tests gate on the sentinel).
# ---------------------------------------------------------------------------

try:
    from ..services.docbrain import ocr_document as _ocr_document_real
    from ..services.docbrain import extract_entities as _extract_entities_real
    ocr_document = _ocr_document_real
    extract_entities = _extract_entities_real
except Exception:  # noqa: BLE001
    ocr_document = None       # type: ignore[assignment]
    extract_entities = None   # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Lazy imports of docbrain-ai-engineer services.
# If those modules are not yet present (e.g., in unit tests) the router still
# imports cleanly; only the individual endpoint will raise 503 at call time.
# ---------------------------------------------------------------------------

def _import_learner():
    try:
        from ..services.docbrain import doctype_learner  # noqa: PLC0415
        return doctype_learner
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"doctype_learner service not yet available: {exc}",
        )


def _import_tamper():
    try:
        from ..services.docbrain import tamper  # noqa: PLC0415
        return tamper
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"tamper service not yet available: {exc}",
        )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(
    prefix="/api/v1/docbrain/doctypes",
    tags=["doctypes"],
    dependencies=[Depends(require_api_key)],
)

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SampleInput(BaseModel):
    bytes_b64: str
    mime_type: str = "application/octet-stream"
    filename: str = "sample"


class SampleInputWithSha(SampleInput):
    sha256: Optional[str] = None


class DoctypeInferRequest(BaseModel):
    samples: List[SampleInput] = Field(..., min_length=3, max_length=10)


class FieldSchema(BaseModel):
    name: str
    type: str = "string"
    required: bool = False
    description: Optional[str] = None


class DoctypeCommitRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    fields: List[FieldSchema] = Field(default_factory=list)
    samples: List[SampleInputWithSha] = Field(..., min_length=1)
    inference_status: str = Field(default="draft", pattern="^(draft|live|manual)$")


class DoctypeClassifyOneRequest(BaseModel):
    bytes_b64: str
    mime_type: str = "application/octet-stream"


class DoctypeTamperCheckRequest(BaseModel):
    bytes_b64: Optional[str] = None
    mime_type: Optional[str] = None
    document_id: Optional[int] = None

    @field_validator("bytes_b64", "document_id", mode="before")
    @classmethod
    def at_least_one(cls, v, info):
        return v  # cross-field validation done in endpoint


# ---------------------------------------------------------------------------
# DB helpers — auto-create tables when the db-migrator hasn't run yet
# (graceful degradation so tests using an in-memory DB still work).
# ---------------------------------------------------------------------------

_SCHEMAS_DDL = """
CREATE TABLE IF NOT EXISTS document_type_schemas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    description         TEXT,
    fields_json         TEXT NOT NULL DEFAULT '[]',
    schema_version      INTEGER NOT NULL DEFAULT 1,
    inference_status    TEXT NOT NULL DEFAULT 'manual',
    source_samples_count INTEGER NOT NULL DEFAULT 0,
    vector_index_version INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tenant_id           TEXT NOT NULL DEFAULT 'default'
);
"""

_SAMPLES_DDL = """
CREATE TABLE IF NOT EXISTS document_type_samples (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_id           INTEGER NOT NULL,
    filename            TEXT NOT NULL,
    sha256              TEXT NOT NULL,
    storage_key         TEXT NOT NULL,
    size                INTEGER NOT NULL DEFAULT 0,
    mime_type           TEXT NOT NULL DEFAULT '',
    ocr_text            TEXT,
    ocr_backend         TEXT,
    ocr_mean_confidence REAL,
    schema_version      INTEGER,
    uploaded_by         TEXT,
    uploaded_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tenant_id           TEXT NOT NULL DEFAULT 'default',
    UNIQUE(schema_id, sha256)
);
"""


def _ensure_tables(db: Session) -> None:
    db.execute(sqltext(_SCHEMAS_DDL))
    db.execute(sqltext(_SAMPLES_DDL))
    db.commit()


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

_MIME_TO_EXT: Dict[str, str] = {
    "image/png":        "png",
    "image/jpeg":       "jpg",
    "image/jpg":        "jpg",
    "image/tiff":       "tiff",
    "image/webp":       "webp",
    "image/gif":        "gif",
    "application/pdf":  "pdf",
    "text/plain":       "txt",
}


def _ext_from_mime(mime: str) -> str:
    guessed = _MIME_TO_EXT.get(mime.lower())
    if guessed:
        return guessed
    ext = mimetypes.guess_extension(mime.lower()) or ".bin"
    return ext.lstrip(".")


def _sample_path(schema_id: int, sha256: str, mime: str) -> str:
    ext = _ext_from_mime(mime)
    base = os.path.join(settings.STORAGE_DIR, "doctype_samples", str(schema_id))
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, f"{sha256}.{ext}")


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _decode_b64(b64: str) -> bytes:
    try:
        return base64.b64decode(b64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid base64: {exc}")


def _make_thumbnail_data_url(data: bytes, mime: str) -> Optional[str]:
    """
    Returns a data-URL thumbnail for image or PDF inputs.
    Best-effort: returns None rather than raising if dependencies are absent.
    """
    try:
        if mime == "application/pdf":
            from pdf2image import convert_from_bytes  # noqa: PLC0415
            images = convert_from_bytes(data, first_page=1, last_page=1, dpi=72)
            if not images:
                return None
            img = images[0]
        else:
            from PIL import Image  # noqa: PLC0415
            img = Image.open(io.BytesIO(data))

        img.thumbnail((256, 256))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/png;base64,{b64}"
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Endpoint 1 — POST /infer  (preview only, no persistence)
# ---------------------------------------------------------------------------

@router.post("/infer")
def infer(req: DoctypeInferRequest):
    """
    Preview step: run infer_schema() on 3-10 samples, return proposed schema.
    Nothing is persisted or indexed.
    """
    learner = _import_learner()
    decoded = [_decode_b64(s.bytes_b64) for s in req.samples]

    result = learner.infer_schema(
        samples=[
            {"data": d, "mime_type": s.mime_type, "filename": s.filename}
            for d, s in zip(decoded, req.samples)
        ]
    )
    return result


# ---------------------------------------------------------------------------
# Endpoint 2 — POST /commit
# ---------------------------------------------------------------------------

@router.post("/commit")
def commit(req: DoctypeCommitRequest, db: Session = Depends(get_db)):
    """
    Persist a new or updated document_type_schemas row, write sample bytes to
    STORAGE_DIR/doctype_samples/<schema_id>/, insert document_type_samples rows
    (idempotent by sha256), call embed_samples(), then baseline_fingerprint().
    """
    import json  # noqa: PLC0415

    learner = _import_learner()
    tamper  = _import_tamper()

    _ensure_tables(db)

    fields_json = json.dumps([f.model_dump() for f in req.fields])
    now = datetime.now(timezone.utc).isoformat()

    # Upsert the schema row (match by name within default tenant).
    row = db.execute(
        sqltext("SELECT id, schema_version FROM document_type_schemas WHERE name = :name AND tenant_id = 'default'"),
        {"name": req.name},
    ).first()

    if row is None:
        db.execute(
            sqltext(
                "INSERT INTO document_type_schemas "
                "(name, description, fields_json, inference_status, updated_at) "
                "VALUES (:name, :desc, :fields, :status, :now)"
            ),
            {
                "name": req.name,
                "desc": req.description or "",
                "fields": fields_json,
                "status": req.inference_status,
                "now": now,
            },
        )
        db.commit()
        schema_id: int = db.execute(
            sqltext("SELECT id FROM document_type_schemas WHERE name = :name AND tenant_id = 'default'"),
            {"name": req.name},
        ).first()[0]
        current_version = 1
    else:
        schema_id = row[0]
        current_version = (row[1] or 1) + 1
        db.execute(
            sqltext(
                "UPDATE document_type_schemas SET description=:desc, fields_json=:fields, "
                "inference_status=:status, schema_version=:ver, updated_at=:now "
                "WHERE id=:id"
            ),
            {
                "desc": req.description or "",
                "fields": fields_json,
                "status": req.inference_status,
                "ver": current_version,
                "now": now,
                "id": schema_id,
            },
        )
        db.commit()

    # Write sample bytes and insert rows.
    saved = 0
    sample_payloads = []

    for s in req.samples:
        data = _decode_b64(s.bytes_b64)
        sha = s.sha256 or _sha256_bytes(data)
        storage_path = _sample_path(schema_id, sha, s.mime_type)
        storage_key  = os.path.relpath(storage_path, settings.STORAGE_DIR)

        if not os.path.exists(storage_path):
            with open(storage_path, "wb") as fh:
                fh.write(data)

        # Idempotent insert.
        existing = db.execute(
            sqltext("SELECT id FROM document_type_samples WHERE schema_id=:sid AND sha256=:sha"),
            {"sid": schema_id, "sha": sha},
        ).first()

        if existing is None:
            db.execute(
                sqltext(
                    "INSERT INTO document_type_samples "
                    "(schema_id, filename, sha256, storage_key, size, mime_type, schema_version) "
                    "VALUES (:sid, :fname, :sha, :key, :size, :mime, :ver)"
                ),
                {
                    "sid":   schema_id,
                    "fname": s.filename,
                    "sha":   sha,
                    "key":   storage_key,
                    "size":  len(data),
                    "mime":  s.mime_type,
                    "ver":   current_version,
                },
            )
            saved += 1

        sample_payloads.append({"data": data, "mime_type": s.mime_type, "sha256": sha})

    db.execute(
        sqltext("UPDATE document_type_schemas SET source_samples_count=source_samples_count+:n WHERE id=:id"),
        {"n": saved, "id": schema_id},
    )
    db.commit()

    # Embed and fingerprint.
    vectors_indexed = learner.embed_samples(schema_id=schema_id, samples=sample_payloads)
    tamper.baseline_fingerprint(schema_id=schema_id, samples=sample_payloads)

    return {"schema_id": schema_id, "samples_saved": saved, "vectors_indexed": vectors_indexed}


# ---------------------------------------------------------------------------
# Endpoint 3 — GET /{schema_id}/samples
# ---------------------------------------------------------------------------

@router.get("/{schema_id}/samples")
def list_samples(schema_id: int, db: Session = Depends(get_db)):
    """Return stored samples for a schema (no ocr_text to stay small)."""
    _ensure_tables(db)
    rows = db.execute(
        sqltext(
            "SELECT id, filename, size, mime_type, ocr_mean_confidence, "
            "       ocr_backend, uploaded_at "
            "FROM document_type_samples WHERE schema_id=:sid ORDER BY id"
        ),
        {"sid": schema_id},
    ).fetchall()

    return [
        {
            "id": r[0],
            "filename": r[1],
            "size": r[2],
            "mime_type": r[3],
            "ocr_mean_confidence": r[4],
            "ocr_backend": r[5],
            "uploaded_at": r[6],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Endpoint 4 — GET /{schema_id}/samples/{sample_id}
# ---------------------------------------------------------------------------

@router.get("/{schema_id}/samples/{sample_id}")
def get_sample(schema_id: int, sample_id: int, db: Session = Depends(get_db)):
    """Return a single sample incl. truncated ocr_text and thumbnail data-URL."""
    _ensure_tables(db)
    row = db.execute(
        sqltext(
            "SELECT id, filename, size, mime_type, ocr_mean_confidence, "
            "       ocr_backend, uploaded_at, ocr_text, storage_key "
            "FROM document_type_samples WHERE id=:id AND schema_id=:sid"
        ),
        {"id": sample_id, "sid": schema_id},
    ).first()

    if row is None:
        raise HTTPException(status_code=404, detail="sample not found")

    ocr_text_full: Optional[str] = row[7]
    storage_key: str = row[8]
    storage_path = os.path.join(settings.STORAGE_DIR, storage_key)

    thumbnail: Optional[str] = None
    if os.path.exists(storage_path):
        try:
            with open(storage_path, "rb") as fh:
                raw = fh.read()
            thumbnail = _make_thumbnail_data_url(raw, row[3])
        except Exception:  # noqa: BLE001
            pass

    return {
        "id": row[0],
        "filename": row[1],
        "size": row[2],
        "mime_type": row[3],
        "ocr_mean_confidence": row[4],
        "ocr_backend": row[5],
        "uploaded_at": row[6],
        "ocr_text_preview": (ocr_text_full or "")[:2000],
        "thumbnail_data_url": thumbnail,
    }


# ---------------------------------------------------------------------------
# Endpoint 5 — DELETE /{schema_id}/samples/{sample_id}
# ---------------------------------------------------------------------------

@router.delete("/{schema_id}/samples/{sample_id}")
def delete_sample(schema_id: int, sample_id: int, db: Session = Depends(get_db)):
    """Remove row, file from disk, vector chunks, recompute baseline fingerprint."""
    _ensure_tables(db)
    row = db.execute(
        sqltext(
            "SELECT sha256, storage_key, mime_type FROM document_type_samples "
            "WHERE id=:id AND schema_id=:sid"
        ),
        {"id": sample_id, "sid": schema_id},
    ).first()

    if row is None:
        raise HTTPException(status_code=404, detail="sample not found")

    sha256, storage_key, mime_type = row
    storage_path = os.path.join(settings.STORAGE_DIR, storage_key)

    # Best-effort: remove vector chunks before deleting the file.
    try:
        learner = _import_learner()
        learner.embed_samples(
            schema_id=schema_id,
            samples=[],          # empty list signals removal of this sha256
            remove_sha256=sha256,
        )
    except Exception:  # noqa: BLE001
        pass

    # Delete file.
    try:
        if os.path.exists(storage_path):
            os.remove(storage_path)
    except OSError as exc:
        log.warning("could not remove sample file %s: %s", storage_path, exc)

    # Delete DB row.
    db.execute(
        sqltext("DELETE FROM document_type_samples WHERE id=:id"),
        {"id": sample_id},
    )
    db.execute(
        sqltext(
            "UPDATE document_type_schemas SET source_samples_count=MAX(0, source_samples_count-1) "
            "WHERE id=:sid"
        ),
        {"sid": schema_id},
    )
    db.commit()

    # Recompute fingerprint over remaining samples.
    _recompute_fingerprint(schema_id, db)

    return {"deleted": True}


def _recompute_fingerprint(schema_id: int, db: Session) -> None:
    """Load remaining sample files and recompute the tamper baseline."""
    try:
        tamper = _import_tamper()
    except HTTPException:
        return

    rows = db.execute(
        sqltext("SELECT storage_key, mime_type, sha256 FROM document_type_samples WHERE schema_id=:sid"),
        {"sid": schema_id},
    ).fetchall()

    payloads = []
    for storage_key, mime, sha in rows:
        path = os.path.join(settings.STORAGE_DIR, storage_key)
        if os.path.exists(path):
            with open(path, "rb") as fh:
                payloads.append({"data": fh.read(), "mime_type": mime, "sha256": sha})

    try:
        tamper.baseline_fingerprint(schema_id=schema_id, samples=payloads)
    except Exception as exc:  # noqa: BLE001
        log.warning("baseline_fingerprint failed after delete: %s", exc)


# ---------------------------------------------------------------------------
# Endpoint 6 — POST /{schema_id}/reindex
# ---------------------------------------------------------------------------

@router.post("/{schema_id}/reindex")
def reindex(schema_id: int, db: Session = Depends(get_db)):
    """
    Re-run OCR + extraction on all stored samples with the current vision
    model, update ocr_text / ocr_backend / schema_version rows, re-embed,
    and recompute the tamper fingerprint.
    """
    if ocr_document is None:
        raise HTTPException(status_code=503, detail="OCR service not available")

    _ensure_tables(db)
    learner = _import_learner()
    tamper  = _import_tamper()

    rows = db.execute(
        sqltext(
            "SELECT id, storage_key, mime_type, sha256 "
            "FROM document_type_samples WHERE schema_id=:sid"
        ),
        {"sid": schema_id},
    ).fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="no samples found for this schema")

    # Bump schema version.
    db.execute(
        sqltext(
            "UPDATE document_type_schemas "
            "SET schema_version=schema_version+1, updated_at=:now WHERE id=:sid"
        ),
        {"now": datetime.now(timezone.utc).isoformat(), "sid": schema_id},
    )
    db.commit()

    new_version: int = db.execute(
        sqltext("SELECT schema_version FROM document_type_schemas WHERE id=:sid"),
        {"sid": schema_id},
    ).first()[0]

    sample_payloads = []
    reindexed = 0

    for row_id, storage_key, mime, sha in rows:
        path = os.path.join(settings.STORAGE_DIR, storage_key)
        if not os.path.exists(path):
            log.warning("reindex: missing file %s", path)
            continue

        with open(path, "rb") as fh:
            data = fh.read()

        try:
            ocr_res = ocr_document(data, mime)
            db.execute(
                sqltext(
                    "UPDATE document_type_samples SET ocr_text=:text, ocr_backend=:backend, "
                    "ocr_mean_confidence=:conf, schema_version=:ver WHERE id=:id"
                ),
                {
                    "text":    ocr_res.full_text,
                    "backend": ocr_res.backend,
                    "conf":    ocr_res.mean_confidence,
                    "ver":     new_version,
                    "id":      row_id,
                },
            )
            reindexed += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("reindex OCR failed for sample %d: %s", row_id, exc)

        sample_payloads.append({"data": data, "mime_type": mime, "sha256": sha})

    db.commit()

    learner.embed_samples(schema_id=schema_id, samples=sample_payloads)
    tamper.baseline_fingerprint(schema_id=schema_id, samples=sample_payloads)

    return {"samples_reindexed": reindexed, "new_schema_version": new_version}


# ---------------------------------------------------------------------------
# Endpoint 7 — POST /classify-one
# ---------------------------------------------------------------------------

@router.post("/classify-one")
def classify_one(req: DoctypeClassifyOneRequest):
    """
    OCR the document, call nearest_schemas(), call extract_entities() with
    a schema hint, return best_match + alternatives + extraction + ocr summary.
    """
    if ocr_document is None or extract_entities is None:
        raise HTTPException(status_code=503, detail="OCR service not available")

    learner = _import_learner()
    data    = _decode_b64(req.bytes_b64)
    ocr_res = ocr_document(data, req.mime_type)  # type: ignore[misc]

    matches = learner.nearest_schemas(ocr_res.full_text)

    best_match   = matches[0] if matches else None
    alternatives = matches[1:] if len(matches) > 1 else []

    schema_hint = best_match.get("name") if best_match else None
    extraction  = extract_entities(ocr_res.full_text, schema_hint=schema_hint)  # type: ignore[misc]

    extraction_dict: Dict[str, Any]
    if hasattr(extraction, "__dict__"):
        extraction_dict = {
            k: (v.value if hasattr(v, "value") else v)
            for k, v in vars(extraction).items()
            if not k.startswith("_")
        }
    else:
        extraction_dict = dict(extraction) if extraction else {}

    return {
        "best_match":   best_match,
        "alternatives": alternatives,
        "extraction":   extraction_dict,
        "ocr": {
            "backend":         ocr_res.backend,
            "mean_confidence": ocr_res.mean_confidence,
        },
    }


# ---------------------------------------------------------------------------
# Endpoint 8 — POST /{schema_id}/tamper-check
# ---------------------------------------------------------------------------

@router.post("/{schema_id}/tamper-check")
def tamper_check(
    schema_id: int,
    req: DoctypeTamperCheckRequest,
    db: Session = Depends(get_db),
):
    """
    Run check_tamper() on the supplied bytes (or look them up from documents
    table if document_id is provided). Returns the TamperReport as JSON.
    """
    if not req.bytes_b64 and req.document_id is None:
        raise HTTPException(
            status_code=400,
            detail="supply either bytes_b64 or document_id",
        )

    tamper_svc = _import_tamper()

    if req.bytes_b64:
        data = _decode_b64(req.bytes_b64)
        mime = req.mime_type or "application/octet-stream"
    else:
        # Look up bytes from the documents table.
        row = db.execute(
            sqltext("SELECT storage_key, mime_type FROM documents WHERE id=:id"),
            {"id": req.document_id},
        ).first()
        if row is None:
            raise HTTPException(status_code=404, detail="document not found")
        doc_path = os.path.join(settings.STORAGE_DIR, row[0])
        if not os.path.exists(doc_path):
            raise HTTPException(status_code=404, detail="document file not found on disk")
        with open(doc_path, "rb") as fh:
            data = fh.read()
        mime = row[1] or "application/octet-stream"

    report = tamper_svc.check_tamper(
        schema_id=schema_id,
        data=data,
        mime_type=mime,
    )

    # Return report as plain dict whether it is a dataclass, pydantic model, or dict.
    if hasattr(report, "model_dump"):
        return report.model_dump()
    if hasattr(report, "__dict__"):
        return vars(report)
    return dict(report)

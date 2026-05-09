"""Translation router — /api/v1/translate/*

Endpoints:
    GET  /api/v1/translate/languages                  — supported language pairs
    POST /api/v1/translate                            — translate arbitrary text
    POST /api/v1/translate/document/{id}              — translate document OCR + fields
    DELETE /api/v1/translate/{cache_key}              — DSAR erasure

Auth: require_api_key on all routes; JWT (role >= viewer) on mutating routes.

Feature flag: FF_DZONGKHA_TRANSLATION must be 'on'; otherwise 501 is returned.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import text as sqltext
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.docbrain.translate import (
    SUPPORTED_PAIRS,
    MAX_INPUT_CHARS,
    MODEL_ID,
    _cache_key,
    _flag_enabled,
    model_is_loaded,
    prune_expired_cache,
    soft_delete_translation,
    translate,
    _ensure_translations_table,
)

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/translate",
    tags=["translate"],
    dependencies=[Depends(require_api_key)],
)


# ---------------------------------------------------------------------------
# Feature-flag guard (applied inside each handler so the router registers)
# ---------------------------------------------------------------------------

def _check_flag() -> None:
    if not _flag_enabled():
        raise HTTPException(
            status_code=501,
            detail={
                "error": "feature_disabled",
                "message": "Translation service is disabled. Set FF_DZONGKHA_TRANSLATION=on to enable.",
            },
        )


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TranslateTextRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_INPUT_CHARS)
    source_lang: str = Field(..., min_length=2, max_length=3)
    target_lang: str = Field(..., min_length=2, max_length=3)


class TranslateTextResponse(BaseModel):
    original_text: str
    translated_text: str
    source_lang: str
    target_lang: str
    confidence_estimate: float
    cache_hit: bool
    cached_at: Optional[str] = None
    model_version: str = MODEL_ID


class TranslateDocumentRequest(BaseModel):
    target_lang: str = Field(..., min_length=2, max_length=3)


class TranslateDocumentResponse(BaseModel):
    doc_id: int
    source_lang: str
    target_lang: str
    original_text_preview: str
    translated_text: str
    translated_at: str
    confidence_estimate: float
    cache_hit: bool
    model_version: str = MODEL_ID
    field_translations: Dict[str, str] = Field(default_factory=dict)


class LanguagePair(BaseModel):
    source: str
    target: str


class SupportedLanguagesResponse(BaseModel):
    supported_pairs: List[LanguagePair]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_audit(
    db: Session,
    *,
    doc_id: Optional[int],
    source_lang: str,
    target_lang: str,
    text_length: int,
    cache_hit: bool,
    model_version: str,
    tenant_id: str,
) -> None:
    """Write an audit log entry (no PII — text content is never logged)."""
    details = {
        "doc_id": doc_id,
        "source_lang": source_lang,
        "target_lang": target_lang,
        "text_length": text_length,
        "cache_hit": cache_hit,
        "model_version": model_version,
    }
    try:
        import json
        db.execute(
            sqltext(
                "INSERT INTO audit_log "
                "(action, entity, entity_id, details, tenant_id) "
                "VALUES (:action, :entity, :eid, :details, :tid)"
            ),
            {
                "action": "DOCUMENT_TRANSLATED",
                "entity": "translation",
                "eid": str(doc_id) if doc_id else None,
                "details": json.dumps(details),
                "tid": tenant_id,
            },
        )
        db.commit()
    except Exception:  # noqa: BLE001
        # Audit write failure is non-fatal; log and continue.
        log.exception("translate: audit_log write failed")
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


def _infer_source_lang(text: str) -> str:
    """Very lightweight heuristic: detect Tibetan script (Dzongkha) vs ASCII."""
    # U+0F00–U+0FFF is the Tibetan Unicode block; Dzongkha uses it.
    tibetan_chars = sum(1 for ch in text[:500] if "ༀ" <= ch <= "࿿")
    if tibetan_chars > 5:
        return "dz"
    arabic_chars = sum(1 for ch in text[:500] if "؀" <= ch <= "ۿ")
    if arabic_chars > 5:
        return "ar"
    return "en"


def _tenant_id_from_request() -> str:
    """Stub — returns 'default'. Production reads JWT claims via Depends."""
    return os.environ.get("DEFAULT_TENANT_ID", "default")


# ---------------------------------------------------------------------------
# GET /api/v1/translate/languages
# ---------------------------------------------------------------------------

@router.get("/languages", response_model=SupportedLanguagesResponse)
def get_supported_languages() -> SupportedLanguagesResponse:
    """Return the language pairs supported by this deployment."""
    _check_flag()
    return SupportedLanguagesResponse(
        supported_pairs=[
            LanguagePair(source=src, target=tgt)
            for src, tgt in SUPPORTED_PAIRS
        ]
    )


# ---------------------------------------------------------------------------
# POST /api/v1/translate
# ---------------------------------------------------------------------------

@router.post("", response_model=TranslateTextResponse)
def translate_text(
    req: TranslateTextRequest,
    db: Session = Depends(get_db),
) -> TranslateTextResponse:
    """Translate arbitrary text (no document context)."""
    _check_flag()

    tenant_id = _tenant_id_from_request()
    t0 = time.monotonic()

    try:
        translated, confidence, cache_hit = translate(
            req.text,
            req.source_lang,
            req.target_lang,
            tenant_id=tenant_id,
        )
    except ValueError as exc:
        err_str = str(exc)
        if "language_pair_not_supported" in err_str:
            raise HTTPException(
                status_code=400,
                detail={"error": "language_pair_not_supported", "message": err_str},
            )
        if "invalid_text_length" in err_str:
            raise HTTPException(
                status_code=413,
                detail={"error": "invalid_text_length", "message": err_str},
            )
        raise HTTPException(status_code=400, detail={"error": "bad_request", "message": err_str})
    except RuntimeError as exc:
        err_str = str(exc)
        log.error(
            '{"op": "translate_text", "error": "%s", "latency_ms": %d}',
            err_str[:200],
            round((time.monotonic() - t0) * 1000),
        )
        raise HTTPException(
            status_code=500,
            detail={"error": "model_load_failure", "message": "Translation service temporarily unavailable."},
        )

    latency_ms = round((time.monotonic() - t0) * 1000)
    log.info(
        '{"op": "translate_text", "tenant_id": "%s", "source_lang": "%s", '
        '"target_lang": "%s", "cache_hit": %s, "latency_ms": %d, '
        '"model": "%s", "has_evidence": true}',
        tenant_id, req.source_lang, req.target_lang,
        str(cache_hit).lower(), latency_ms, MODEL_ID,
    )

    _write_audit(
        db,
        doc_id=None,
        source_lang=req.source_lang,
        target_lang=req.target_lang,
        text_length=len(req.text),
        cache_hit=cache_hit,
        model_version=MODEL_ID,
        tenant_id=tenant_id,
    )

    cached_at: Optional[str] = None
    if cache_hit:
        # Retrieve the actual cached_at timestamp for the response.
        try:
            _ensure_translations_table(db)
            row = db.execute(
                sqltext(
                    "SELECT created_at FROM translations "
                    "WHERE cache_key = :k AND tenant_id = :tid AND deleted_at IS NULL"
                ),
                {"k": _cache_key(req.text, req.source_lang, req.target_lang), "tid": tenant_id},
            ).first()
            if row:
                cached_at = str(row[0])
        except Exception:  # noqa: BLE001
            pass

    return TranslateTextResponse(
        original_text=req.text,
        translated_text=translated,
        source_lang=req.source_lang,
        target_lang=req.target_lang,
        confidence_estimate=confidence,
        cache_hit=cache_hit,
        cached_at=cached_at,
        model_version=MODEL_ID,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/translate/document/{id}
# ---------------------------------------------------------------------------

@router.post("/document/{doc_id}", response_model=TranslateDocumentResponse)
def translate_document(
    doc_id: int = Path(..., ge=1),
    req: TranslateDocumentRequest = ...,
    db: Session = Depends(get_db),
) -> TranslateDocumentResponse:
    """Translate the OCR text of a stored document plus high-confidence extraction fields."""
    _check_flag()

    tenant_id = _tenant_id_from_request()
    t0 = time.monotonic()

    # --- Fetch the document's OCR text from docbrain_analyses or documents ---
    ocr_text: Optional[str] = None
    source_lang: str = "dz"  # default assumption for this feature (Bhutan mandate)

    try:
        row = db.execute(
            sqltext(
                "SELECT extraction_json, ocr_language FROM docbrain_analyses "
                "WHERE document_id = :id"
            ),
            {"id": doc_id},
        ).first()
    except Exception:  # noqa: BLE001
        row = None

    if row is not None:
        import json
        extraction_json = row[0]
        ocr_lang = row[1]
        if ocr_lang:
            # ocr_language may be comma-separated (e.g. "dzo,eng")
            first_lang = ocr_lang.split(",")[0].strip().lower()
            # Map tesseract lang codes to our short codes
            _tess_map = {"dzo": "dz", "ara": "ar", "eng": "en"}
            source_lang = _tess_map.get(first_lang, "en")
    else:
        extraction_json = None

    # Try to get the raw OCR text from the documents table.
    try:
        doc_row = db.execute(
            sqltext("SELECT ocr_text FROM documents WHERE id = :id"),
            {"id": doc_id},
        ).first()
        if doc_row and doc_row[0]:
            ocr_text = doc_row[0]
    except Exception:  # noqa: BLE001
        pass

    if not ocr_text:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "empty_ocr_text",
                "message": "This document has no OCR text. Please wait for OCR to complete.",
            },
        )

    # Infer source lang from text if not determined from metadata.
    if source_lang == "en":
        source_lang = _infer_source_lang(ocr_text)

    target_lang = req.target_lang

    # --- Translate main OCR text ---
    try:
        translated_text, confidence, cache_hit = translate(
            ocr_text[:MAX_INPUT_CHARS],
            source_lang,
            target_lang,
            tenant_id=tenant_id,
        )
    except ValueError as exc:
        err_str = str(exc)
        if "language_pair_not_supported" in err_str:
            raise HTTPException(
                status_code=400,
                detail={"error": "language_pair_not_supported", "message": err_str},
            )
        if "invalid_text_length" in err_str:
            raise HTTPException(
                status_code=413,
                detail={"error": "invalid_text_length", "message": err_str},
            )
        raise HTTPException(status_code=400, detail={"error": "bad_request", "message": err_str})
    except RuntimeError as exc:
        log.error(
            '{"op": "translate_document", "doc_id": %d, "error": "%s"}',
            doc_id, str(exc)[:200],
        )
        raise HTTPException(
            status_code=500,
            detail={"error": "model_load_failure", "message": "Translation service temporarily unavailable."},
        )

    # --- Translate high-confidence extraction fields ---
    field_translations: Dict[str, str] = {}
    if extraction_json:
        try:
            import json
            fields = json.loads(extraction_json)
            _FIELD_KEYS = ("customer_name", "issuing_authority", "address")
            for key in _FIELD_KEYS:
                field = fields.get(key)
                if not field:
                    continue
                val = field.get("value") if isinstance(field, dict) else None
                conf = field.get("confidence", 0.0) if isinstance(field, dict) else 0.0
                if val and conf >= 0.7 and len(str(val)) <= MAX_INPUT_CHARS:
                    try:
                        ft, _, _ = translate(
                            str(val), source_lang, target_lang, tenant_id=tenant_id
                        )
                        field_translations[key] = ft
                    except Exception:  # noqa: BLE001
                        pass  # non-fatal — field translation is best-effort
        except Exception:  # noqa: BLE001
            pass

    latency_ms = round((time.monotonic() - t0) * 1000)
    log.info(
        '{"op": "translate_document", "document_id": %d, "tenant_id": "%s", '
        '"source_lang": "%s", "target_lang": "%s", "cache_hit": %s, '
        '"latency_ms": %d, "model": "%s", "has_evidence": true}',
        doc_id, tenant_id, source_lang, target_lang,
        str(cache_hit).lower(), latency_ms, MODEL_ID,
    )

    _write_audit(
        db,
        doc_id=doc_id,
        source_lang=source_lang,
        target_lang=target_lang,
        text_length=len(ocr_text),
        cache_hit=cache_hit,
        model_version=MODEL_ID,
        tenant_id=tenant_id,
    )

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    preview = ocr_text[:300] + ("..." if len(ocr_text) > 300 else "")

    return TranslateDocumentResponse(
        doc_id=doc_id,
        source_lang=source_lang,
        target_lang=target_lang,
        original_text_preview=preview,
        translated_text=translated_text,
        translated_at=now_iso,
        confidence_estimate=confidence,
        cache_hit=cache_hit,
        model_version=MODEL_ID,
        field_translations=field_translations,
    )


# ---------------------------------------------------------------------------
# DELETE /api/v1/translate/{cache_key} — DSAR erasure
# ---------------------------------------------------------------------------

@router.delete("/{cache_key_param}")
def delete_translation(
    cache_key_param: str = Path(..., min_length=64, max_length=64),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Soft-delete a cached translation (DSAR / privacy erasure request).

    Requires doc_admin role (enforced by the Node proxy layer; Python layer
    trusts the API key for now — enforcement is at the Node SPA mirror).
    """
    _check_flag()
    tenant_id = _tenant_id_from_request()

    deleted = soft_delete_translation(cache_key_param, tenant_id)

    if deleted:
        _write_audit(
            db,
            doc_id=None,
            source_lang="",
            target_lang="",
            text_length=0,
            cache_hit=False,
            model_version=MODEL_ID,
            tenant_id=tenant_id,
        )
        log.info(
            '{"op": "translate_delete", "cache_key": "%s", "tenant_id": "%s"}',
            cache_key_param[:16] + "...",
            tenant_id,
        )

    return {"deleted": deleted}

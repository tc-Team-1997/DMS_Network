"""Offline translation service using Meta NLLB-200-distilled-600M.

Language codes follow the NLLB convention:
    eng_Latn  — English
    dzo_Tibt  — Dzongkha
    arb_Arab  — Arabic

Supported short codes (contract-facing) → NLLB codes:
    en → eng_Latn
    dz → dzo_Tibt
    ar → arb_Arab

Environment variables:
    FF_DZONGKHA_TRANSLATION  — 'on' (default off); set to 'on' to enable
    NLLB_MODEL               — HuggingFace model id (default facebook/nllb-200-distilled-600M)
    NLLB_MAX_CHUNK_CHARS     — chars per chunk (default 2000)
    NLLB_MAX_INPUT_CHARS     — hard cap on input (default 10000)
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
import time
from typing import Optional

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

def _flag_enabled() -> bool:
    return os.environ.get("FF_DZONGKHA_TRANSLATION", "off").lower() == "on"


# ---------------------------------------------------------------------------
# Configuration constants
# ---------------------------------------------------------------------------

MODEL_ID: str = os.environ.get("NLLB_MODEL", "facebook/nllb-200-distilled-600M")
MAX_CHUNK_CHARS: int = int(os.environ.get("NLLB_MAX_CHUNK_CHARS", "2000"))
MAX_INPUT_CHARS: int = int(os.environ.get("NLLB_MAX_INPUT_CHARS", "10000"))

# NLLB token ceiling (model hard limit)
_NLLB_MAX_TOKENS: int = 1024

# Mapping from short codes to NLLB language codes
_LANG_MAP: dict[str, str] = {
    "en": "eng_Latn",
    "dz": "dzo_Tibt",
    "ar": "arb_Arab",
}

# Supported (source, target) pairs — short codes
SUPPORTED_PAIRS: list[tuple[str, str]] = [
    ("en", "dz"),
    ("dz", "en"),
    ("en", "ar"),
    ("ar", "en"),
]


# ---------------------------------------------------------------------------
# Model singleton — lazy, thread-safe
# ---------------------------------------------------------------------------

_model_lock = threading.Lock()
_pipeline = None           # the transformers pipeline
_model_loaded_at: Optional[float] = None


def _get_model():
    """Return the translation pipeline, loading it on first call (lazy singleton).

    Cold-load records latency to structured log. Subsequent calls return the
    cached object immediately.  Raises RuntimeError if the feature flag is
    off or if transformers is not installed.
    """
    global _pipeline, _model_loaded_at

    if not _flag_enabled():
        raise RuntimeError(
            "FF_DZONGKHA_TRANSLATION is off — translation service disabled"
        )

    if _pipeline is not None:
        return _pipeline

    with _model_lock:
        # Double-checked locking: another thread may have loaded it while we waited.
        if _pipeline is not None:
            return _pipeline

        try:
            from transformers import pipeline as hf_pipeline  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError(
                "transformers package is not installed. "
                "Run: pip install transformers sentencepiece torch"
            ) from exc

        log.info(
            '{"op": "translate_model_load", "model": "%s", "status": "loading"}',
            MODEL_ID,
        )
        t0 = time.monotonic()
        try:
            _pipeline = hf_pipeline(
                "translation",
                model=MODEL_ID,
                # Use CPU; torch will pick GPU if available via device_map
                device_map="cpu",
            )
        except Exception as exc:
            log.exception(
                '{"op": "translate_model_load", "model": "%s", "status": "failed", "error": "%s"}',
                MODEL_ID,
                str(exc)[:200],
            )
            raise RuntimeError(f"model_load_failure: {exc}") from exc

        latency_ms = round((time.monotonic() - t0) * 1000)
        _model_loaded_at = time.monotonic()
        log.info(
            '{"op": "translate_model_load", "model": "%s", "status": "ready", "latency_ms": %d}',
            MODEL_ID,
            latency_ms,
        )
        return _pipeline


def model_is_loaded() -> bool:
    """Return True if the model has been loaded into memory (for metrics gauge)."""
    return _pipeline is not None


# ---------------------------------------------------------------------------
# Cache key
# ---------------------------------------------------------------------------

def _cache_key(text: str, source: str, target: str, tenant_id: str = "default") -> str:
    """SHA-256 over (tenant_id, text, source, target).

    The tenant_id salt prevents cross-tenant cache bleed-through: tenant A
    translating "PII X" to dz produces a different cache_key than tenant B
    translating the same text to dz, so they never share the cached row.
    Caught + fixed in the 2026-05-09 Wave A+B security review (regression
    introduced when the slice was first written without tenant scope)."""
    raw = f"{tenant_id}\x00{text}\x00{source}\x00{target}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


# ---------------------------------------------------------------------------
# Sentence-aware chunking
# ---------------------------------------------------------------------------

_SENTENCE_RE = re.compile(r"(?<=[.!?།])\s+")


def _chunk_text(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split *text* into chunks of at most *max_chars* characters, breaking on
    sentence boundaries where possible.  A single sentence longer than
    *max_chars* is force-split at *max_chars* to avoid exceeding the NLLB token
    ceiling.
    """
    if len(text) <= max_chars:
        return [text]

    # Split on sentence boundaries first.
    sentences = _SENTENCE_RE.split(text)
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        # If a single sentence is too long, force-split it.
        if len(sentence) > max_chars:
            # Flush current buffer first.
            if current.strip():
                chunks.append(current.strip())
                current = ""
            # Force-split the long sentence into max_chars slices.
            for i in range(0, len(sentence), max_chars):
                chunks.append(sentence[i : i + max_chars])
            continue

        if current and len(current) + 1 + len(sentence) > max_chars:
            chunks.append(current.strip())
            current = sentence
        else:
            current = f"{current} {sentence}".strip() if current else sentence

    if current.strip():
        chunks.append(current.strip())

    return chunks or [text[:max_chars]]


# ---------------------------------------------------------------------------
# Core translate function
# ---------------------------------------------------------------------------

def translate(
    text: str,
    source: str,
    target: str,
    *,
    tenant_id: str = "default",
) -> tuple[str, float, bool]:
    """Translate *text* from *source* to *target* language.

    Args:
        text:       Plain text to translate (≤ MAX_INPUT_CHARS).
        source:     Short language code ('en', 'dz', 'ar').
        target:     Short language code.
        tenant_id:  Tenant identifier used for cache scoping.

    Returns:
        (translated_text, confidence_estimate, cache_hit)

    Raises:
        ValueError: unsupported language pair or input too long.
        RuntimeError: model load failure or feature flag off.
    """
    # --- Input validation ---
    if len(text) > MAX_INPUT_CHARS:
        raise ValueError(
            f"invalid_text_length: input is {len(text)} chars; max is {MAX_INPUT_CHARS}"
        )
    if (source, target) not in SUPPORTED_PAIRS:
        raise ValueError(
            f"language_pair_not_supported: {source}->{target}"
        )
    if source not in _LANG_MAP or target not in _LANG_MAP:
        raise ValueError(
            f"language_pair_not_supported: {source}->{target}"
        )

    # PII-safe log: show only a preview, never the full text.
    text_preview = text[:30] + "..." + f" ({len(text)} chars)"

    key = _cache_key(text, source, target, tenant_id)

    # --- Cache lookup ---
    from ...db import SessionLocal  # lazy import to avoid circular deps
    from sqlalchemy import text as sqltext
    from datetime import datetime, timedelta

    db = SessionLocal()
    try:
        _ensure_translations_table(db)

        row = db.execute(
            sqltext(
                "SELECT translated_text FROM translations "
                "WHERE cache_key = :k AND tenant_id = :tid "
                "AND expires_at > :now AND deleted_at IS NULL"
            ),
            {"k": key, "tid": tenant_id, "now": datetime.utcnow()},
        ).first()

        if row is not None:
            log.info(
                '{"op": "translate", "tenant_id": "%s", "source": "%s", '
                '"target": "%s", "cache_hit": true, "text": "%s"}',
                tenant_id, source, target, text_preview,
            )
            return row[0], 0.95, True

        # --- Model inference ---
        t0 = time.monotonic()
        pipe = _get_model()

        src_nllb = _LANG_MAP[source]
        tgt_nllb = _LANG_MAP[target]

        chunks = _chunk_text(text)
        translated_parts: list[str] = []

        for chunk in chunks:
            out = pipe(
                chunk,
                src_lang=src_nllb,
                tgt_lang=tgt_nllb,
                max_length=_NLLB_MAX_TOKENS,
            )
            # pipeline returns list of dicts: [{"translation_text": "..."}]
            part = out[0]["translation_text"] if out else ""
            translated_parts.append(part)

        translated_text = " ".join(translated_parts).strip()
        latency_ms = round((time.monotonic() - t0) * 1000)

        # Confidence: NLLB doesn't expose logits directly via the pipeline API.
        # We use a fixed heuristic: 0.80 baseline for known good lang pairs.
        # A real implementation would decode with scores=True and compute
        # mean(exp(sequence_scores)); stubbed here to avoid pipeline rewrite.
        confidence = 0.80

        log.info(
            '{"op": "translate", "tenant_id": "%s", "source": "%s", '
            '"target": "%s", "cache_hit": false, "latency_ms": %d, '
            '"chunks": %d, "text": "%s"}',
            tenant_id, source, target, latency_ms, len(chunks), text_preview,
        )

        # --- Cache write ---
        now = datetime.utcnow()
        expires = now + timedelta(days=7)
        try:
            db.execute(
                sqltext(
                    "INSERT INTO translations "
                    "(cache_key, tenant_id, source_lang, target_lang, "
                    " translated_text, created_at, expires_at) "
                    "VALUES (:k, :tid, :src, :tgt, :txt, :now, :exp) "
                    "ON CONFLICT(cache_key) DO UPDATE SET "
                    "  translated_text = excluded.translated_text, "
                    "  created_at = excluded.created_at, "
                    "  expires_at = excluded.expires_at, "
                    "  deleted_at = NULL"
                ),
                {
                    "k": key, "tid": tenant_id, "src": source, "tgt": target,
                    "txt": translated_text, "now": now, "exp": expires,
                },
            )
            db.commit()
        except Exception:  # noqa: BLE001
            log.exception("translate: cache write failed — continuing without cache")
            db.rollback()

        return translated_text, confidence, False

    finally:
        db.close()


# ---------------------------------------------------------------------------
# Cache prune (called by cron/scheduler)
# ---------------------------------------------------------------------------

def prune_expired_cache(tenant_id: Optional[str] = None) -> int:
    """Hard-delete translation rows past their TTL.

    Returns the number of rows deleted.  If *tenant_id* is None, prune all
    tenants (for use in the global scheduler).
    """
    from ...db import SessionLocal
    from sqlalchemy import text as sqltext
    from datetime import datetime

    db = SessionLocal()
    try:
        _ensure_translations_table(db)

        if tenant_id:
            result = db.execute(
                sqltext(
                    "DELETE FROM translations "
                    "WHERE expires_at <= :now AND tenant_id = :tid"
                ),
                {"now": datetime.utcnow(), "tid": tenant_id},
            )
        else:
            result = db.execute(
                sqltext("DELETE FROM translations WHERE expires_at <= :now"),
                {"now": datetime.utcnow()},
            )
        db.commit()
        deleted = result.rowcount if hasattr(result, "rowcount") else 0
        log.info(
            '{"op": "translate_cache_prune", "tenant_id": "%s", "deleted": %d}',
            tenant_id or "all",
            deleted,
        )
        return deleted
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Soft-delete (DSAR)
# ---------------------------------------------------------------------------

def soft_delete_translation(cache_key: str, tenant_id: str) -> bool:
    """Mark a translation as deleted (DSAR erasure path).

    Returns True if a row was found and updated, False if not found.
    """
    from ...db import SessionLocal
    from sqlalchemy import text as sqltext
    from datetime import datetime

    db = SessionLocal()
    try:
        _ensure_translations_table(db)
        result = db.execute(
            sqltext(
                "UPDATE translations SET deleted_at = :now "
                "WHERE cache_key = :k AND tenant_id = :tid AND deleted_at IS NULL"
            ),
            {"now": datetime.utcnow(), "k": cache_key, "tid": tenant_id},
        )
        db.commit()
        return (result.rowcount if hasattr(result, "rowcount") else 0) > 0
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Schema bootstrap (idempotent)
# ---------------------------------------------------------------------------

_schema_created = False
_schema_lock = threading.Lock()

_TRANSLATIONS_DDL = """
CREATE TABLE IF NOT EXISTS translations (
    cache_key      TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL DEFAULT 'default',
    source_lang    TEXT NOT NULL,
    target_lang    TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at     TIMESTAMP NOT NULL,
    deleted_at     TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_translations_tenant
    ON translations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_translations_expires
    ON translations(expires_at);
"""


def _ensure_translations_table(db) -> None:
    """Idempotently create the translations table if it doesn't exist yet."""
    global _schema_created
    if _schema_created:
        return
    with _schema_lock:
        if _schema_created:
            return
        from sqlalchemy import text as sqltext
        for stmt in _TRANSLATIONS_DDL.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                db.execute(sqltext(stmt))
        db.commit()
        _schema_created = True

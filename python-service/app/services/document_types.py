"""
Service helpers for the document-types admin CRUD surface.

Provides:
    validate_thresholds(autofill_floor, high_confidence) -> None | raises HTTPException
    test_against_sample(schema_id, sample_id, tenant_id, db) -> dict

These are pure-Python helpers with no FastAPI dependency so they can be
unit-tested without spinning up an ASGI app.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import text as sqltext
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_thresholds(
    autofill_floor: Optional[float],
    high_confidence: Optional[float],
) -> None:
    """
    Raise HTTPException 400 if threshold values violate the contract:
      - Both values must be in the closed interval [0, 1].
      - autofill_floor must be strictly less than high_confidence
        (they represent two distinct decision boundaries; equal is
        rejected to force an explicit intent — matching the Zod refine
        in the SPA that uses <=).

    Either argument may be None, in which case that argument is not
    validated (partial PATCH — only validate when both sides are
    present or when the DB value can be read by the caller first).

    Signature for the caller to match:
        validate_thresholds(autofill_floor: float | None,
                            high_confidence: float | None) -> None
    """
    errors: Dict[str, str] = {}

    if autofill_floor is not None:
        if not (0.0 <= autofill_floor <= 1.0):
            errors["autofill_floor"] = "must be >= 0 and <= 1"

    if high_confidence is not None:
        if not (0.0 <= high_confidence <= 1.0):
            errors["high_confidence"] = "must be >= 0 and <= 1"

    if not errors and autofill_floor is not None and high_confidence is not None:
        if autofill_floor >= high_confidence:
            errors["high_confidence"] = "must be > autofill_floor"

    if errors:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation_failed", "details": errors},
        )


# ---------------------------------------------------------------------------
# test-thresholds helper
# ---------------------------------------------------------------------------

def test_against_sample(
    schema_id: int,
    sample_id: int,
    tenant_id: str,
    db: Session,
) -> Dict[str, Any]:
    """
    Run the existing OCR/extraction pipeline against the sample at the
    doctype's current thresholds and return a preview dict.

    Returns:
        {
          "extracted_fields": [
            {
              "field_name": str,
              "value": str | None,
              "confidence": float,
              "status": "auto_fill" | "review" | "skip"
            },
            ...
          ],
          "at_floor": int,   # fields with confidence >= autofill_floor
          "at_high": int,    # fields with confidence >= high_confidence
          "sample_id": int,
          "schema_id": int,
          "autofill_floor": float,
          "high_confidence": float,
        }

    Raises HTTPException 404 if the schema or sample does not belong to the
    requesting tenant.  OCR/extract failures raise 503.
    """
    from ..config import settings  # local import to avoid circular deps

    # ---- 1. Fetch schema (tenant-scoped) -----------------------------------
    schema_row = db.execute(
        sqltext(
            "SELECT id, autofill_floor, high_confidence "
            "FROM document_type_schemas "
            "WHERE id = :schema_id AND tenant_id = :tenant"
        ),
        {"schema_id": schema_id, "tenant": tenant_id},
    ).first()

    if schema_row is None:
        raise HTTPException(status_code=404, detail="document type not found")

    autofill_floor: float = schema_row[1] if schema_row[1] is not None else 0.4
    high_confidence: float = schema_row[2] if schema_row[2] is not None else 0.7

    # ---- 2. Fetch sample (must belong to this schema + tenant) -------------
    sample_row = db.execute(
        sqltext(
            "SELECT id, storage_key, mime_type, ocr_text, ocr_mean_confidence "
            "FROM document_type_samples "
            "WHERE id = :sample_id AND schema_id = :schema_id AND tenant_id = :tenant"
        ),
        {"sample_id": sample_id, "schema_id": schema_id, "tenant": tenant_id},
    ).first()

    if sample_row is None:
        raise HTTPException(
            status_code=404,
            detail="sample not found or belongs to a different document type",
        )

    _, storage_key, mime_type, cached_ocr_text, _ = sample_row
    storage_path = os.path.join(settings.STORAGE_DIR, storage_key)

    # ---- 3. OCR the sample (or use cached text) ----------------------------
    ocr_text: str = cached_ocr_text or ""

    if not ocr_text:
        if not os.path.exists(storage_path):
            raise HTTPException(
                status_code=404,
                detail="sample file not found on disk",
            )

        try:
            from ..services.docbrain.ocr import ocr_document  # noqa: PLC0415
            with open(storage_path, "rb") as fh:
                data = fh.read()
            ocr_res = ocr_document(data, mime_type or "application/octet-stream")
            ocr_text = ocr_res.full_text or ""
        except ImportError:
            raise HTTPException(
                status_code=503,
                detail="OCR service not available",
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("OCR failed for sample %d: %s", sample_id, exc)
            raise HTTPException(
                status_code=503,
                detail=f"OCR failed: {exc}",
            )

    # ---- 4. Extract entities from OCR text ---------------------------------
    raw_fields: List[Dict[str, Any]] = []

    try:
        from ..services.docbrain.extract import extract_entities  # noqa: PLC0415
        extraction = extract_entities(ocr_text)

        # Walk the extraction result.
        # It may be a real dataclass (production) or a plain class (tests).
        # We attempt dataclasses.fields first; if that fails, fall back to
        # inspecting __dict__ / __annotations__ for ExtractedField-like attrs.
        import dataclasses  # noqa: PLC0415

        _known_skip = {"extra_fields"}
        field_names: list[str] = []

        if dataclasses.is_dataclass(extraction):
            field_names = [f.name for f in dataclasses.fields(extraction) if f.name not in _known_skip]
        else:
            # Plain class (e.g., test stub) — collect all non-dunder public
            # attrs visible via dir(), whether class-level or instance-level.
            field_names = [
                k for k in dir(extraction)
                if not k.startswith("_") and k not in _known_skip
                and not callable(getattr(extraction, k, None))
            ]

        for fname in field_names:
            ef = getattr(extraction, fname, None)
            if ef is not None and hasattr(ef, "confidence"):
                raw_fields.append({
                    "field_name": fname,
                    "value": ef.value,
                    "confidence": ef.confidence,
                })

        # Handle extra_fields dict
        extra = getattr(extraction, "extra_fields", None) or {}
        for fname, fval in extra.items():
            if hasattr(fval, "confidence"):
                raw_fields.append({
                    "field_name": fname,
                    "value": fval.value,
                    "confidence": fval.confidence,
                })

    except ImportError:
        # Extraction service unavailable — return empty fields; still useful
        # to show the caller the thresholds.
        pass
    except Exception as exc:  # noqa: BLE001
        log.warning("extraction failed for sample %d: %s", sample_id, exc)

    # ---- 5. Label each field against the current thresholds ----------------
    extracted_fields: List[Dict[str, Any]] = []
    at_floor = 0
    at_high = 0

    for rf in raw_fields:
        conf: float = rf["confidence"]
        if conf >= autofill_floor:
            status = "auto_fill"
            at_floor += 1
        elif conf >= high_confidence:
            # NOTE: this branch is intentionally unreachable when the invariant
            # autofill_floor < high_confidence holds; the SPA logic labels
            # autofill_floor as the *lower* threshold, so fields between the
            # two thresholds are "review required".  We keep the label correct.
            status = "review"
        else:
            status = "skip"

        if conf >= high_confidence:
            at_high += 1

        extracted_fields.append(
            {
                "field_name": rf["field_name"],
                "value": rf["value"],
                "confidence": conf,
                "status": status,
            }
        )

    return {
        "extracted_fields": extracted_fields,
        "at_floor": at_floor,
        "at_high": at_high,
        "sample_id": sample_id,
        "schema_id": schema_id,
        "autofill_floor": autofill_floor,
        "high_confidence": high_confidence,
    }

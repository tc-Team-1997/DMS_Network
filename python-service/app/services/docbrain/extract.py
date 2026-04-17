"""Llama-based structured NER for banking documents.

Pulls the fields a maker would otherwise hand-key: customer CID, name, doc
number, DOB, issue/expiry dates, issuing authority, address. Returns per-field
confidence so the UI can flag uncertain fields for human review.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Dict, Optional

from .llm import chat_json

log = logging.getLogger(__name__)


@dataclass
class ExtractedField:
    value: Optional[str]
    confidence: float   # 0..1


@dataclass
class ExtractionResult:
    customer_cid:        ExtractedField
    customer_name:       ExtractedField
    doc_number:          ExtractedField
    dob:                 ExtractedField
    issue_date:          ExtractedField
    expiry_date:         ExtractedField
    issuing_authority:   ExtractedField
    address:             ExtractedField

    def as_prefill(self, confidence_floor: float = 0.7) -> Dict[str, str]:
        """
        Flatten for Capture auto-fill. Only returns fields above the
        confidence floor so low-confidence guesses don't pollute the form.
        """
        out: Dict[str, str] = {}
        for key in (
            "customer_cid", "customer_name", "doc_number", "dob",
            "issue_date", "expiry_date", "issuing_authority", "address",
        ):
            f: ExtractedField = getattr(self, key)
            if f.value and f.confidence >= confidence_floor:
                out[key] = f.value
        return out


SYSTEM_PROMPT = """You are DocBrain, a named-entity extractor for banking documents.
From the OCR text below, extract these fields:

  customer_cid        - customer identifier (Egyptian CID format "EGY-YYYY-NNNNN", national ID, or bank customer number)
  customer_name       - full legal name of the person the document is about
  doc_number          - the document's own identifier (passport number, contract number, etc.)
  dob                 - date of birth (ISO 8601 format YYYY-MM-DD)
  issue_date          - issue date (ISO 8601)
  expiry_date         - expiry date (ISO 8601)
  issuing_authority   - who issued the document
  address             - address if one is clearly present

Reply as a JSON object. For each field, return:
    { "value": "<extracted string or null>", "confidence": <number 0..1> }

Return null (not an empty string) for fields not present in the text.
Dates MUST be ISO 8601. If the text gives a date in another format, convert
it. If you cannot parse it, return null with confidence 0.
Do not invent information. Do not hallucinate Egyptian CID formatting if
the document is not Egyptian.
"""

_FIELDS = (
    "customer_cid", "customer_name", "doc_number", "dob",
    "issue_date", "expiry_date", "issuing_authority", "address",
)

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse_field(raw: object) -> ExtractedField:
    """Coerce a messy LLM reply into (value, confidence). Defensive."""
    if not isinstance(raw, dict):
        return ExtractedField(value=None, confidence=0.0)
    value = raw.get("value")
    if value is None or value == "null" or value == "":
        return ExtractedField(value=None, confidence=0.0)
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    try:
        confidence = float(raw.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    return ExtractedField(value=value, confidence=round(confidence, 3))


def _validate_dates(result: Dict[str, ExtractedField]) -> Dict[str, ExtractedField]:
    """Clear any date fields that aren't ISO 8601 — we'd rather null than wrong."""
    for k in ("dob", "issue_date", "expiry_date"):
        f = result[k]
        if f.value and not _ISO_DATE.match(f.value):
            log.debug("dropping non-ISO date for %s: %r", k, f.value)
            result[k] = ExtractedField(value=None, confidence=0.0)
    return result


def extract_entities(ocr_text: str, *, max_chars: int = 5000) -> ExtractionResult:
    if not ocr_text or len(ocr_text.strip()) < 20:
        empty = {k: ExtractedField(value=None, confidence=0.0) for k in _FIELDS}
        return ExtractionResult(**empty)

    snippet = ocr_text.strip()[:max_chars]
    reply = chat_json(SYSTEM_PROMPT, snippet, temperature=0.0)
    parsed = {k: _parse_field(reply.get(k)) for k in _FIELDS}
    parsed = _validate_dates(parsed)
    return ExtractionResult(**parsed)

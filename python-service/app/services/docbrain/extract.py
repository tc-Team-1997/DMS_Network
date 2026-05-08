"""Llama-based structured NER for banking documents.

Pulls the fields a maker would otherwise hand-key: customer CID, name, doc
number, DOB, issue/expiry dates, issuing authority, address. Returns per-field
confidence so the UI can flag uncertain fields for human review.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

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
    extra_fields:        Dict[str, ExtractedField] = field(default_factory=dict)

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

  customer_cid        - the citizen / customer identifier on the document. Examples:
                        Bhutanese Citizenship ID No. (11 digits, e.g. "10712002883"),
                        Egyptian National ID (14 digits), Indian Aadhaar, bank customer
                        number / CIF, or any label explicitly called "CID",
                        "Citizenship ID", "National ID No.", "Customer ID".
                        Prefer the longest pure-numeric identifier when multiple appear.
  customer_name       - full legal name of the person the document is about. Concatenate
                        surname + given names when listed separately.
  doc_number          - the document's own identifier (passport number, card number,
                        contract number, etc.) — distinct from customer_cid.
  dob                 - date of birth (ISO 8601 format YYYY-MM-DD)
  issue_date          - issue date (ISO 8601)
  expiry_date         - expiry date (ISO 8601)
  issuing_authority   - who issued the document (e.g. "KINGDOM OF BHUTAN",
                        "Royal Bhutan Police", "Ministry of Interior")
  address             - address if one is clearly present

Reply as a JSON object. For each field, return:
    { "value": "<extracted string or null>", "confidence": <number 0..1> }

Return null (not an empty string) for fields not present in the text.
Dates MUST be ISO 8601. Common input formats to convert:
  "26/12/2000"   -> "2000-12-26"   (DD/MM/YYYY, default for non-US documents)
  "15 JAN 1990"  -> "1990-01-15"
If you cannot parse a date unambiguously, return null with confidence 0.
Do not invent information. If the document is not Egyptian, do NOT impose
Egyptian CID formatting.
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


_SCHEMA_HINT_BLOCK = """\n\nAdditional context: This document is known to be type: {name}.
Expected schema-specific fields (extract these in addition to the 8 canonical fields above,
using the same {{\"value\": ..., \"confidence\": ...}} format):
{field_list}
Return these extra fields under their exact key names alongside the 8 canonical fields."""


def extract_entities(
    ocr_text: str,
    *,
    max_chars: int = 5000,
    schema_hint: Optional[Any] = None,
) -> ExtractionResult:
    """
    Extract 8 canonical fields from OCR text, plus any extra fields defined
    in schema_hint.

    schema_hint may be:
      - a dict with keys "name" and "fields" (list of {"key": ..., "label": ...})
      - a string (treated as the schema name only, no extra fields)
      - None (unchanged behaviour)
    """
    if not ocr_text or len(ocr_text.strip()) < 20:
        empty = {k: ExtractedField(value=None, confidence=0.0) for k in _FIELDS}
        return ExtractionResult(**empty)

    snippet = ocr_text.strip()[:max_chars]

    # Build system prompt, optionally extended with schema-hint block.
    effective_prompt = SYSTEM_PROMPT
    extra_keys: list = []

    if schema_hint:
        hint_name = ""
        hint_fields: list = []
        if isinstance(schema_hint, dict):
            hint_name   = str(schema_hint.get("name", ""))
            hint_fields = schema_hint.get("fields", [])
        elif isinstance(schema_hint, str):
            hint_name = schema_hint

        if hint_name:
            field_list_str = ""
            for f in hint_fields:
                key   = str(f.get("key", ""))
                label = str(f.get("label", key))
                if key:
                    field_list_str += f"  {key} ({label})\n"
                    extra_keys.append(key)
            effective_prompt = SYSTEM_PROMPT + _SCHEMA_HINT_BLOCK.format(
                name=hint_name,
                field_list=field_list_str or "  (none specified)",
            )

    reply = chat_json(effective_prompt, snippet, temperature=0.0)
    parsed: Dict[str, ExtractedField] = {k: _parse_field(reply.get(k)) for k in _FIELDS}
    parsed = _validate_dates(parsed)

    # Parse extra schema-specific fields.
    extra_fields: Dict[str, ExtractedField] = {}
    for key in extra_keys:
        raw = reply.get(key)
        if raw is not None:
            extra_fields[key] = _parse_field(raw)

    return ExtractionResult(**parsed, extra_fields=extra_fields)

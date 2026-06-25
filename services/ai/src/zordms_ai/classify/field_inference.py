"""AI sample-based FIELD DETECTION.

Given a SAMPLE document image (+ optional doc_type_hint), ask the vision model
to propose a METADATA FIELD SCHEMA for that document type — a list of field
objects the admin can use to define a doc-type's capture form.

Field-object shape (aligned with P5's ``{name, type, mandatory}``):

    {
      "name":         snake_case identifier   (str),
      "label":        human-readable label     (str),
      "type":         one of string|date|number|enum (str),
      "mandatory":    best-guess boolean        (bool),
      "sample_value": value read from the doc   (str),
    }

The model is prompted to return a JSON *array* of these objects.  The reply is
parsed/repaired robustly (models wrap JSON in prose / fences), capped, and
deduped by ``name``.  If the vision backend is unavailable the proposer returns
a *degraded* result (empty fields + a human note) instead of raising — callers
turn that into a 200 response, never a 500.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Cap the number of fields we return — a sensible metadata form rarely needs
# more, and it bounds the blast radius of a hallucinating model.
MAX_FIELDS = 25

ALLOWED_TYPES = ("string", "date", "number", "enum")

# A JSON schema is passed to the vision client purely so the Ollama adapter can
# build a field guide; the array result is parsed by us, not the adapter.
FIELDS_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "label": {"type": "string"},
                    "type": {"type": "string", "enum": list(ALLOWED_TYPES)},
                    "mandatory": {"type": "boolean"},
                    "sample_value": {"type": "string"},
                },
                "required": ["name", "label", "type", "mandatory", "sample_value"],
            },
        }
    },
    "required": ["fields"],
}

_SYSTEM = (
    "You are a document-schema designer for an enterprise document management "
    "system. Given a sample document, you propose the metadata fields that an "
    "admin should capture for every document of this type."
)


class InferredField(BaseModel):
    name: str
    label: str
    type: str = "string"
    mandatory: bool = False
    sample_value: str = ""


class InferFieldsResult(BaseModel):
    doc_type_hint: str | None = None
    fields: list[InferredField] = Field(default_factory=list)
    degraded: bool = False
    note: str | None = None


# --- snake_case + type normalisation -------------------------------------

_NON_WORD_RE = re.compile(r"[^a-z0-9]+")


def _snake_case(value: str) -> str:
    """Best-effort snake_case of an arbitrary field name."""
    if not value:
        return ""
    # split camelCase / PascalCase boundaries first
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", str(value))
    lowered = spaced.strip().lower()
    snake = _NON_WORD_RE.sub("_", lowered).strip("_")
    return snake


def _normalise_type(value: Any) -> str:
    t = str(value or "").strip().lower()
    if t in ALLOWED_TYPES:
        return t
    # common synonyms the model may emit
    if t in ("text", "str", "varchar", "char"):
        return "string"
    if t in ("int", "integer", "float", "decimal", "double", "num"):
        return "number"
    if t in ("datetime", "timestamp"):
        return "date"
    if t in ("select", "choice", "category", "boolean", "bool"):
        return "enum"
    return "string"


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes", "y", "required", "mandatory")
    return bool(value)


# --- robust JSON-array extraction -----------------------------------------

_ARRAY_RE = re.compile(r"\[.*\]", re.DOTALL)
_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_field_list(raw: Any) -> list[dict[str, Any]]:
    """Coerce a model reply (dict from the adapter, or free text) into a list
    of field dicts. Repairs trailing commas and strips surrounding prose."""
    # The vision adapter (Ollama) returns a dict; vLLM returns parsed JSON too.
    if isinstance(raw, dict):
        # Either {"fields": [...]} or a single bare field object.
        if isinstance(raw.get("fields"), list):
            return [f for f in raw["fields"] if isinstance(f, dict)]
        if {"name", "type"} & set(raw.keys()):
            return [raw]
        # dict-of-dicts fallback: values may each be a field
        nested = [v for v in raw.values() if isinstance(v, dict)]
        if nested:
            return nested
        return []
    if isinstance(raw, list):
        return [f for f in raw if isinstance(f, dict)]
    if not isinstance(raw, str):
        return []

    text = raw.strip()
    # strip markdown fences
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()

    for pattern in (_ARRAY_RE, _OBJECT_RE):
        m = pattern.search(text)
        if not m:
            continue
        candidate = re.sub(r",\s*([}\]])", r"\1", m.group(0))
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        return _extract_field_list(parsed)
    return []


def parse_fields(raw: Any) -> list[InferredField]:
    """Parse → normalise → dedupe model output into InferredField objects."""
    out: list[InferredField] = []
    seen: set[str] = set()
    for item in _extract_field_list(raw):
        raw_name = item.get("name") or item.get("label") or ""
        name = _snake_case(raw_name)
        if not name or name in seen:
            continue
        seen.add(name)
        label = str(item.get("label") or raw_name or name.replace("_", " ").title())
        sample = item.get("sample_value")
        out.append(
            InferredField(
                name=name,
                label=label,
                type=_normalise_type(item.get("type")),
                mandatory=_coerce_bool(item.get("mandatory")),
                sample_value="" if sample is None else str(sample),
            )
        )
        if len(out) >= MAX_FIELDS:
            break
    return out


def build_infer_prompt(doc_type_hint: str | None) -> str:
    lines = [
        "Look at this SAMPLE document and propose the metadata fields that an "
        "admin should capture for EVERY document of this type.",
        "Return a JSON ARRAY of field objects. Each object must have:",
        '  - "name": a snake_case identifier (e.g. "invoice_number")',
        '  - "label": a human-readable label (e.g. "Invoice Number")',
        '  - "type": one of "string", "date", "number", "enum"',
        '  - "mandatory": your best guess (true/false) whether the field is required',
        '  - "sample_value": the value you read for this field from the sample',
        "Propose only fields that are genuinely useful metadata for this document type.",
    ]
    if doc_type_hint:
        lines.append(
            f"The admin believes this document is of type '{doc_type_hint}'. "
            "Tailor the fields to that type."
        )
    lines.append("Respond with ONLY the JSON array — no prose, no markdown fences.")
    return "\n".join(lines)


class FieldInferer:
    """Proposes a metadata field schema from a sample document image.

    Wraps the resolved vision client (same one the Classifier/Extractor use).
    Degrades gracefully — never raises for backend/parse failures.
    """

    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    async def infer(
        self, image_b64: str, doc_type_hint: str | None = None
    ) -> InferFieldsResult:
        prompt = build_infer_prompt(doc_type_hint)
        try:
            raw = await self._client.chat_json(
                model=self._model,
                system=_SYSTEM,
                user_text=prompt,
                image_b64=image_b64,
                json_schema=FIELDS_JSON_SCHEMA,
            )
        except Exception as exc:  # backend down / HTTP error / parse error
            logger.warning("Field inference degraded: %s", exc)
            return InferFieldsResult(
                doc_type_hint=doc_type_hint,
                fields=[],
                degraded=True,
                note=(
                    "Vision backend unavailable — could not infer fields. "
                    "Add fields manually or retry when the model is reachable."
                ),
            )

        fields = parse_fields(raw)
        if not fields:
            return InferFieldsResult(
                doc_type_hint=doc_type_hint,
                fields=[],
                degraded=True,
                note="Model returned no usable fields. Add fields manually or retry.",
            )
        return InferFieldsResult(doc_type_hint=doc_type_hint, fields=fields, degraded=False)

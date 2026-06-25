"""Micro-level unit tests for classify.field_inference internals.

Targets the pure helpers (_snake_case, _normalise_type, _coerce_bool,
_extract_field_list) and FieldInferer.infer directly — complementing the
API-level tests in test_infer_fields.py. No network / model calls.
"""
from __future__ import annotations

import pytest

from zordms_ai.classify.field_inference import (
    ALLOWED_TYPES,
    MAX_FIELDS,
    FieldInferer,
    InferredField,
    _coerce_bool,
    _extract_field_list,
    _normalise_type,
    _snake_case,
    build_infer_prompt,
    parse_fields,
)


# ── _snake_case ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("Invoice Number", "invoice_number"),
    ("invoiceNumber", "invoice_number"),
    ("InvoiceNumber", "invoice_number"),
    ("  Total  Amount  ", "total_amount"),
    ("ref#99/section", "ref_99_section"),
    ("___leading_trailing___", "leading_trailing"),
    ("", ""),
])
def test_snake_case(raw, expected):
    assert _snake_case(raw) == expected


# ── _normalise_type ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("string", "string"),
    ("DATE", "date"),
    ("text", "string"),
    ("varchar", "string"),
    ("int", "number"),
    ("decimal", "number"),
    ("datetime", "date"),
    ("timestamp", "date"),
    ("select", "enum"),
    ("boolean", "enum"),
    ("category", "enum"),
    ("totally-unknown", "string"),  # unknown -> default string
    (None, "string"),
    ("", "string"),
])
def test_normalise_type(raw, expected):
    out = _normalise_type(raw)
    assert out == expected
    assert out in ALLOWED_TYPES


# ── _coerce_bool ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    (True, True),
    (False, False),
    ("true", True),
    ("YES", True),
    ("required", True),
    ("mandatory", True),
    ("1", True),
    ("no", False),
    ("false", False),
    ("", False),
    (1, True),
    (0, False),
    (None, False),
])
def test_coerce_bool(raw, expected):
    assert _coerce_bool(raw) is expected


# ── _extract_field_list — shape handling ────────────────────────────────────

def test_extract_from_fields_dict():
    assert _extract_field_list({"fields": [{"name": "a"}, {"name": "b"}]}) == [
        {"name": "a"}, {"name": "b"},
    ]


def test_extract_from_bare_field_object():
    # dict with name/type keys but no "fields" -> treated as single field.
    out = _extract_field_list({"name": "x", "type": "string"})
    assert out == [{"name": "x", "type": "string"}]


def test_extract_from_dict_of_dicts():
    out = _extract_field_list({"f1": {"name": "a"}, "f2": {"name": "b"}})
    assert {"name": "a"} in out and {"name": "b"} in out


def test_extract_from_plain_list_filters_non_dicts():
    assert _extract_field_list([{"name": "a"}, "junk", 3]) == [{"name": "a"}]


def test_extract_repairs_trailing_comma_in_array():
    raw = '[{"name": "a", "type": "string",}]'
    assert _extract_field_list(raw) == [{"name": "a", "type": "string"}]


def test_extract_strips_markdown_fences_and_prose():
    raw = 'Here:\n```json\n[{"name":"a"}]\n```\nThanks'
    assert _extract_field_list(raw) == [{"name": "a"}]


def test_extract_returns_empty_for_unparseable_string():
    assert _extract_field_list("no json at all here") == []


def test_extract_returns_empty_for_non_str_non_collection():
    assert _extract_field_list(42) == []


def test_extract_object_regex_path_for_single_object_in_prose():
    # No array present, but a single {...} object -> recursed as bare field.
    raw = 'The field is {"name": "amount", "type": "number"}.'
    assert _extract_field_list(raw) == [{"name": "amount", "type": "number"}]


# ── parse_fields — defaulting label, missing names skipped ──────────────────

def test_parse_fields_skips_items_without_usable_name():
    out = parse_fields({"fields": [{"type": "string"}, {"name": "ok"}]})
    assert [f.name for f in out] == ["ok"]


def test_parse_fields_label_defaults_from_raw_name_when_absent():
    # No label -> falls back to the raw name (not titlecased).
    out = parse_fields({"fields": [{"name": "invoice_number"}]})
    assert out[0].label == "invoice_number"


def test_parse_fields_label_titlecased_only_when_no_raw_name():
    # name derived from label; raw_name comes from label, so label == that.
    out = parse_fields({"fields": [{"label": "Invoice Number"}]})
    assert out[0].name == "invoice_number"
    assert out[0].label == "Invoice Number"


def test_parse_fields_null_sample_value_becomes_empty_string():
    out = parse_fields({"fields": [{"name": "x", "sample_value": None}]})
    assert out[0].sample_value == ""


def test_parse_fields_caps_exactly_at_max():
    raw = {"fields": [{"name": f"f_{i}"} for i in range(MAX_FIELDS + 5)]}
    assert len(parse_fields(raw)) == MAX_FIELDS


# ── build_infer_prompt ──────────────────────────────────────────────────────

def test_build_infer_prompt_without_hint():
    prompt = build_infer_prompt(None)
    assert "JSON ARRAY" in prompt
    assert "snake_case" in prompt
    assert "believes this document is of type" not in prompt


def test_build_infer_prompt_with_hint_mentions_type():
    prompt = build_infer_prompt("passport")
    assert "passport" in prompt
    assert "Tailor the fields" in prompt


# ── FieldInferer.infer — direct, with a fake async client ───────────────────

class _FakeClient:
    def __init__(self, reply=None, exc=None):
        self._reply, self._exc = reply, exc
        self.calls: list[dict] = []

    async def chat_json(self, **kwargs):
        self.calls.append(kwargs)
        if self._exc:
            raise self._exc
        return self._reply


@pytest.mark.asyncio
async def test_inferer_happy_path_passes_model_and_returns_fields():
    client = _FakeClient(reply={"fields": [{"name": "amount", "type": "number"}]})
    inferer = FieldInferer(client, model="qwen2.5vl")
    res = await inferer.infer("b64data", doc_type_hint="invoice")
    assert res.degraded is False
    assert res.doc_type_hint == "invoice"
    assert res.fields == [InferredField(name="amount", label="amount", type="number")]
    # The configured model + image are forwarded to the client.
    assert client.calls[0]["model"] == "qwen2.5vl"
    assert client.calls[0]["image_b64"] == "b64data"


@pytest.mark.asyncio
async def test_inferer_degraded_when_client_raises():
    inferer = FieldInferer(_FakeClient(exc=RuntimeError("backend down")), model="m")
    res = await inferer.infer("b64")
    assert res.degraded is True
    assert res.fields == []
    assert "Vision backend unavailable" in res.note


@pytest.mark.asyncio
async def test_inferer_degraded_when_model_returns_no_usable_fields():
    # Reply parses but yields zero fields (all missing names).
    inferer = FieldInferer(_FakeClient(reply={"fields": [{"type": "string"}]}), model="m")
    res = await inferer.infer("b64")
    assert res.degraded is True
    assert res.fields == []
    assert "no usable fields" in res.note

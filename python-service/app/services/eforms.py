"""JSON-Schema driven e-form validation.

Form schema shape (stored as eforms.schema_json):

    {
      "fields": [
        {"key": "full_name",   "label": "Full Name",     "type": "string",  "required": true, "max_length": 120},
        {"key": "dob",         "label": "Date of Birth", "type": "date",    "required": true},
        {"key": "employment",  "label": "Employment",    "type": "enum",    "options": ["employed","self_employed","retired","student","unemployed"], "required": true},
        {"key": "income_egp",  "label": "Monthly income (EGP)", "type": "number", "min": 0}
      ]
    }
"""
from __future__ import annotations
import json
import re
from datetime import datetime


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate(schema: dict, data: dict) -> tuple[bool, list[str]]:
    errors: list[str] = []
    fields = schema.get("fields", [])
    keys = {f["key"] for f in fields}

    for f in fields:
        k = f["key"]
        v = data.get(k)
        required = f.get("required", False)
        if v is None or v == "":
            if required:
                errors.append(f"{k}: required")
            continue

        t = f.get("type", "string")
        if t == "string":
            if not isinstance(v, str):
                errors.append(f"{k}: expected string")
            elif "max_length" in f and len(v) > f["max_length"]:
                errors.append(f"{k}: max_length {f['max_length']}")
        elif t == "number":
            try:
                n = float(v)
                if "min" in f and n < f["min"]:
                    errors.append(f"{k}: min {f['min']}")
                if "max" in f and n > f["max"]:
                    errors.append(f"{k}: max {f['max']}")
            except (TypeError, ValueError):
                errors.append(f"{k}: expected number")
        elif t == "date":
            if not isinstance(v, str) or not _DATE_RE.match(v):
                errors.append(f"{k}: expected YYYY-MM-DD")
            else:
                try:
                    datetime.strptime(v, "%Y-%m-%d")
                except ValueError:
                    errors.append(f"{k}: invalid date")
        elif t == "enum":
            options = f.get("options", [])
            if v not in options:
                errors.append(f"{k}: must be one of {options}")
        elif t == "boolean":
            if not isinstance(v, bool):
                errors.append(f"{k}: expected boolean")
        else:
            errors.append(f"{k}: unknown type '{t}'")

    # Reject unknown keys — forces clean data capture.
    for k in data:
        if k not in keys:
            errors.append(f"{k}: unknown field")

    return (len(errors) == 0, errors)


def load_schema(schema_json: str) -> dict:
    return json.loads(schema_json or "{}")

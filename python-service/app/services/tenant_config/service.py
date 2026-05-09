"""Tenant configuration service — get / get_namespace / set.

Hash-chain invariant
--------------------
Every write appends a row to tenant_config_history.  The hash covers:

  canonical_json = json.dumps(row_dict, sort_keys=True, separators=(',', ':'))

where row_dict contains exactly these keys (all strings or JSON-native types):

  changed_at, changed_by, key, namespace, reason, schema_version, tenant_id, value

The hash is:
  sha256( (prev_hash or '') + canonical_json ).hexdigest()

CRITICAL: changed_at is generated in Python BEFORE the hash is computed and
passed explicitly into the INSERT.  The column has no server default in the
schema.  This guarantees that the hash in the row exactly equals the hash a
verifier recomputes from the row after a SELECT.

Schema validation
-----------------
Namespace schemas live at <repo-root>/schemas/tenant-config/<namespace>.json.
The service walks up from this file's location to reach the repo root:
  __file__ → service.py → tenant_config/ → services/ → app/ → python-service/ → repo root

Supported JSON Schema keywords (draft-07 subset used by the branding stub):
  type, properties, required, additionalProperties, pattern, minLength,
  maxLength, enum, minimum, maximum.
Unknown keywords raise ValueError so future namespace authors fail loudly.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ...models import TenantConfig, TenantConfigHistory


# ---------------------------------------------------------------------------
# Schema registry
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parents[4]   # service.py → tenant_config/ → services/ → app/ → python-service/ → repo-root
_SCHEMA_DIR = _REPO_ROOT / "schemas" / "tenant-config"

_schema_cache: dict[str, dict] = {}


def _load_schema(namespace: str) -> dict | None:
    """Return the JSON Schema dict for *namespace*, or None if no file exists."""
    if namespace in _schema_cache:
        return _schema_cache[namespace]
    path = _SCHEMA_DIR / f"{namespace}.json"
    if not path.exists():
        return None
    with path.open() as fh:
        schema = json.load(fh)
    _schema_cache[namespace] = schema
    return schema


# ---------------------------------------------------------------------------
# Minimal JSON Schema validator
# ---------------------------------------------------------------------------
# Supported keywords: type, properties, required, additionalProperties,
#   pattern, minLength, maxLength, enum, minimum, maximum.
# Unknown keywords → ValueError so future namespace authors fail loudly.

_SUPPORTED_KEYWORDS = {
    "$schema", "$id", "type", "properties", "required",
    "additionalProperties", "pattern", "minLength", "maxLength",
    "enum", "minimum", "maximum", "description",
}

_TYPE_MAP = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "array": list,
    "object": dict,
    "null": type(None),
}


def _validate_schema_keywords(schema: dict, path: str = "#") -> None:
    """Recursively verify no unsupported keywords are present."""
    for kw in schema:
        if kw not in _SUPPORTED_KEYWORDS:
            raise ValueError(f"validator: unsupported keyword: {kw} (at {path})")
    if "properties" in schema:
        for prop_name, prop_schema in schema["properties"].items():
            _validate_schema_keywords(prop_schema, f"{path}/properties/{prop_name}")


def _validate_value(value: Any, schema: dict, path: str = "#") -> None:
    """Validate *value* against a JSON Schema dict (draft-07 subset)."""
    # Walk schema for unsupported keywords first (fast fail, once per write).
    _validate_schema_keywords(schema, path)

    # type check
    if "type" in schema:
        expected = schema["type"]
        py_type = _TYPE_MAP.get(expected)
        if py_type is None:
            raise ValueError(f"validator: unsupported type: {expected}")
        # bool is a subclass of int in Python — reject it for integer/number.
        if expected in ("integer", "number") and isinstance(value, bool):
            raise ValueError(f"Validation error at {path}: expected {expected}, got bool")
        if not isinstance(value, py_type):
            raise ValueError(
                f"Validation error at {path}: expected {expected}, "
                f"got {type(value).__name__}"
            )

    # enum
    if "enum" in schema:
        if value not in schema["enum"]:
            raise ValueError(
                f"Validation error at {path}: {value!r} not in enum {schema['enum']}"
            )

    # string-specific
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            raise ValueError(
                f"Validation error at {path}: length {len(value)} < minLength {schema['minLength']}"
            )
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            raise ValueError(
                f"Validation error at {path}: length {len(value)} > maxLength {schema['maxLength']}"
            )
        if "pattern" in schema and not re.fullmatch(schema["pattern"], value):
            raise ValueError(
                f"Validation error at {path}: {value!r} does not match pattern {schema['pattern']!r}"
            )

    # numeric
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            raise ValueError(f"Validation error at {path}: {value} < minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            raise ValueError(f"Validation error at {path}: {value} > maximum {schema['maximum']}")

    # object
    if isinstance(value, dict):
        if "required" in schema:
            for req_key in schema["required"]:
                if req_key not in value:
                    raise ValueError(f"Validation error at {path}: missing required key {req_key!r}")
        if "additionalProperties" in schema and schema["additionalProperties"] is False:
            allowed = set(schema.get("properties", {}).keys())
            extra = set(value.keys()) - allowed
            if extra:
                raise ValueError(
                    f"Validation error at {path}: additional properties not allowed: {sorted(extra)}"
                )
        if "properties" in schema:
            for prop_name, prop_schema in schema["properties"].items():
                if prop_name in value:
                    _validate_value(value[prop_name], prop_schema, f"{path}/{prop_name}")


def _validate(namespace: str, key: str, value: Any) -> None:
    """Validate (key, value) against the namespace schema if one exists.

    The namespace schema is structured as a whole-namespace object descriptor:
      {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "<key>": { <value-schema> },
          ...
        }
      }

    Validation rules:
      1. If additionalProperties is false and the key is not in properties →
         raise ValueError (unknown key for this namespace).
      2. If the key is in properties → validate the value against that
         property's sub-schema.
      3. Unknown namespaces (no schema file) → permissive, no validation.
    """
    schema = _load_schema(namespace)
    if schema is None:
        return  # no schema file = permissive for unknown namespaces

    # Check unsupported keywords at the namespace root level.
    _validate_schema_keywords(schema, "#")

    properties = schema.get("properties", {})
    additional_ok = schema.get("additionalProperties", True)

    # Unknown key check.
    if additional_ok is False and key not in properties:
        raise ValueError(
            f"Validation error at #: key {key!r} not allowed in namespace "
            f"{namespace!r} (additionalProperties: false)"
        )

    # Value check against the key's property schema (if defined).
    if key in properties:
        _validate_value(value, properties[key], f"#/properties/{key}")


# ---------------------------------------------------------------------------
# Hash chain
# ---------------------------------------------------------------------------

def _canonical_json(row_dict: dict) -> str:
    """Deterministic JSON with sorted keys, no whitespace."""
    return json.dumps(row_dict, sort_keys=True, separators=(",", ":"))


def _compute_hash(prev_hash: str | None, row_dict: dict) -> str:
    """SHA-256( (prev_hash or '') + canonical_json(row_dict) ).hexdigest()."""
    payload = (prev_hash or "") + _canonical_json(row_dict)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _prev_hash(db: Session, tenant_id: str, namespace: str, key: str) -> str | None:
    """Return the hash of the most recent history row for this key, or None."""
    row = (
        db.query(TenantConfigHistory)
        .filter_by(tenant_id=tenant_id, namespace=namespace, key=key)
        .order_by(TenantConfigHistory.history_id.desc())
        .first()
    )
    return row.hash if row else None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get(db: Session, tenant_id: str, namespace: str, key: str, default: Any = None) -> Any:
    """Return the JSON-decoded value for (tenant_id, namespace, key), or *default*."""
    row = db.query(TenantConfig).filter_by(
        tenant_id=tenant_id, namespace=namespace, key=key
    ).first()
    if row is None:
        return default
    return json.loads(row.value)


def get_namespace(db: Session, tenant_id: str, namespace: str) -> dict[str, Any]:
    """Return all keys in *namespace* as a {key: decoded_value} dict."""
    rows = db.query(TenantConfig).filter_by(
        tenant_id=tenant_id, namespace=namespace
    ).all()
    return {row.key: json.loads(row.value) for row in rows}


def set(                                                    # noqa: A001
    db: Session,
    tenant_id: str,
    namespace: str,
    key: str,
    value: Any,
    *,
    actor_user_id: int | None,
    reason: str,
) -> None:
    """Upsert (tenant_id, namespace, key) = value and append a history row.

    Steps:
      1. Validate *reason* length (>= 20 chars).
      2. Validate *value* against the namespace JSON Schema (if one exists).
      3. JSON-encode *value*.
      4. Generate changed_at = UTC ISO-8601 string (client-side, not server).
      5. Fetch prev_hash from the last history row.
      6. Compute new hash = sha256(prev_hash + canonical_json(history_row_dict)).
      7. Upsert tenant_config.
      8. INSERT tenant_config_history.
      9. Commit.

    Raises ValueError for short reason, schema validation failures.
    """
    if len(reason) < 20:
        raise ValueError(
            f"reason must be at least 20 characters (got {len(reason)})"
        )

    _validate(namespace, key, value)

    encoded_value = json.dumps(value, sort_keys=True, separators=(",", ":"))

    # Step 4: generate timestamp BEFORE computing the hash.
    # Using utcnow + explicit 'Z' suffix matches the Node counterpart exactly.
    changed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"

    # Step 5+6: hash chain.
    prev = _prev_hash(db, tenant_id, namespace, key)
    row_dict_for_hash = {
        "changed_at": changed_at,
        "changed_by": actor_user_id,
        "key": key,
        "namespace": namespace,
        "reason": reason,
        "schema_version": 1,
        "tenant_id": tenant_id,
        "value": encoded_value,
    }
    new_hash = _compute_hash(prev, row_dict_for_hash)

    # Step 7: upsert tenant_config (merge on composite PK).
    existing = db.query(TenantConfig).filter_by(
        tenant_id=tenant_id, namespace=namespace, key=key
    ).first()
    if existing:
        existing.value = encoded_value
        existing.updated_by = actor_user_id
        existing.updated_at = datetime.utcnow()
    else:
        db.add(TenantConfig(
            tenant_id=tenant_id,
            namespace=namespace,
            key=key,
            value=encoded_value,
            schema_version=1,
            updated_by=actor_user_id,
        ))

    # Step 8: append history row.
    db.add(TenantConfigHistory(
        tenant_id=tenant_id,
        namespace=namespace,
        key=key,
        value=encoded_value,
        schema_version=1,
        changed_by=actor_user_id,
        reason=reason,
        changed_at=changed_at,
        prev_hash=prev,
        hash=new_hash,
    ))

    db.commit()

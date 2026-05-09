/**
 * Node-side tenant configuration service.
 *
 * Public API:
 *   getConfig(tenantId, namespace, key, defaultValue)  → any
 *   getNamespace(tenantId, namespace)                  → {key: value, …}
 *   setConfig(tenantId, namespace, key, value, {actorUserId, reason}) → void
 *
 * Hash-chain invariant (mirrors python-service/app/services/tenant_config/service.py):
 *   canonical_json = JSON.stringify(rowDict, sortedReplacer, 0)
 *   hash = sha256( (prevHash || '') + canonical_json )
 *
 * IMPORTANT: changed_at is generated in JS BEFORE computing the hash and
 * is passed explicitly into the INSERT — never relying on a server default.
 * This ensures hash(prevHash + canonicalJson(row)) is deterministically
 * verifiable after a SELECT. See the hash-determinism note in the plan.
 *
 * Schema validation:
 *   JSON Schema files are loaded from <repo-root>/schemas/tenant-config/<namespace>.json.
 *   Both the Node and Python layers read from the same directory, avoiding schema drift.
 *
 * // TODO: replace hand-rolled validator with ajv when CC3 lands;
 * //       current validator is intentionally minimal.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./index');
const { canonicalJson: _canonicalJson, computeHash: _computeHash } = require('./hash-chain');

// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------

const SCHEMA_DIR = path.join(__dirname, '..', 'schemas', 'tenant-config');
const _schemaCache = new Map();

function _loadSchema(namespace) {
  if (_schemaCache.has(namespace)) return _schemaCache.get(namespace);
  const filePath = path.join(SCHEMA_DIR, `${namespace}.json`);
  if (!fs.existsSync(filePath)) {
    _schemaCache.set(namespace, null);
    return null;
  }
  const schema = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  _schemaCache.set(namespace, schema);
  return schema;
}

// ---------------------------------------------------------------------------
// Minimal JSON Schema validator (draft-07 subset)
// Supported keywords: type, properties, required, additionalProperties,
//   pattern, minLength, maxLength, enum, minimum, maximum.
// Unknown keywords → throw so future namespace authors fail loudly.
// ---------------------------------------------------------------------------

// TODO: replace with ajv when CC3 lands; current validator is intentionally minimal.

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', 'type', 'properties', 'required',
  'additionalProperties', 'pattern', 'minLength', 'maxLength',
  'enum', 'minimum', 'maximum', 'description',
]);

function _checkKeywords(schema, path_) {
  for (const kw of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(kw)) {
      throw new Error(`validator: unsupported keyword: ${kw} (at ${path_})`);
    }
  }
  if (schema.properties) {
    for (const [name, sub] of Object.entries(schema.properties)) {
      _checkKeywords(sub, `${path_}/properties/${name}`);
    }
  }
}

function _jsType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // string | number | boolean | object
}

function _validateValue(value, schema, path_) {
  // Unsupported keywords — fail loudly.
  _checkKeywords(schema, path_);

  // type
  if (schema.type !== undefined) {
    const actual = _jsType(value);
    const expected = schema.type;
    // JSON "integer" maps to JS number that is whole.
    if (expected === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Error(`Validation error at ${path_}: expected integer, got ${actual}`);
      }
    } else if (expected === 'number') {
      if (typeof value !== 'number') {
        throw new Error(`Validation error at ${path_}: expected number, got ${actual}`);
      }
    } else {
      // map JSON schema type names to JS typeof outcomes
      const jsTypeMap = { string: 'string', boolean: 'boolean', array: 'array', object: 'object', null: 'null' };
      if (!(expected in jsTypeMap)) {
        throw new Error(`validator: unsupported type: ${expected}`);
      }
      if (actual !== jsTypeMap[expected]) {
        throw new Error(`Validation error at ${path_}: expected ${expected}, got ${actual}`);
      }
    }
  }

  // enum
  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value)) {
      throw new Error(`Validation error at ${path_}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
    }
  }

  // string constraints
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new Error(`Validation error at ${path_}: length ${value.length} < minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new Error(`Validation error at ${path_}: length ${value.length} > maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined) {
      const re = new RegExp(`^(?:${schema.pattern})$`);
      if (!re.test(value)) {
        throw new Error(`Validation error at ${path_}: ${JSON.stringify(value)} does not match pattern ${schema.pattern}`);
      }
    }
  }

  // number constraints
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new Error(`Validation error at ${path_}: ${value} < minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw new Error(`Validation error at ${path_}: ${value} > maximum ${schema.maximum}`);
    }
  }

  // object constraints
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required) {
      for (const reqKey of schema.required) {
        if (!(reqKey in value)) {
          throw new Error(`Validation error at ${path_}: missing required key "${reqKey}"`);
        }
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const k of Object.keys(value)) {
        if (!allowed.has(k)) {
          throw new Error(`Validation error at ${path_}: additional property "${k}" not allowed`);
        }
      }
    }
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in value) {
          _validateValue(value[propName], propSchema, `${path_}/${propName}`);
        }
      }
    }
  }
}

/**
 * Validate (key, value) against the namespace schema if one exists.
 *
 * The namespace schema is a whole-namespace object descriptor:
 *   { type: "object", additionalProperties: false, properties: { <key>: <value-schema> } }
 *
 * Rules:
 *   1. additionalProperties: false + key not in properties → reject (unknown key).
 *   2. key in properties → validate value against that sub-schema.
 *   3. No schema file → permissive.
 */
function _validate(namespace, key, value) {
  const schema = _loadSchema(namespace);
  if (!schema) return; // no schema file = permissive

  // Unsupported keywords check at root.
  _checkKeywords(schema, '#');

  const properties = schema.properties || {};
  const additionalOk = schema.additionalProperties !== false;

  if (!additionalOk && !(key in properties)) {
    throw new Error(
      `Validation error at #: key "${key}" not allowed in namespace "${namespace}" (additionalProperties: false)`
    );
  }

  if (key in properties) {
    _validateValue(value, properties[key], `#/properties/${key}`);
  }
}

// ---------------------------------------------------------------------------
// Hash chain — delegated to db/hash-chain.js (shared with audit_log)
// ---------------------------------------------------------------------------
// _canonicalJson and _computeHash are imported from db/hash-chain.js above.

function _prevHash(tenantId, namespace, key) {
  const row = db.prepare(`
    SELECT hash FROM tenant_config_history
    WHERE tenant_id = ? AND namespace = ? AND key = ?
    ORDER BY history_id DESC
    LIMIT 1
  `).get(tenantId, namespace, key);
  return row ? row.hash : null;
}

// ---------------------------------------------------------------------------
// Prepared statements (lazy-initialised to survive test DB recreation)
// ---------------------------------------------------------------------------

const stmtGet = db.prepare(`
  SELECT value FROM tenant_config
  WHERE tenant_id = ? AND namespace = ? AND key = ?
`);

const stmtGetNs = db.prepare(`
  SELECT key, value FROM tenant_config
  WHERE tenant_id = ? AND namespace = ?
`);

const stmtUpsert = db.prepare(`
  INSERT INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_by, updated_at)
  VALUES (?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(tenant_id, namespace, key)
  DO UPDATE SET
    value          = excluded.value,
    updated_by     = excluded.updated_by,
    updated_at     = excluded.updated_at
`);

const stmtHistory = db.prepare(`
  INSERT INTO tenant_config_history
    (tenant_id, namespace, key, value, schema_version, changed_by, reason, changed_at, prev_hash, hash)
  VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
`);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the JSON-decoded config value, or defaultValue if not found.
 */
function getConfig(tenantId, namespace, key, defaultValue = null) {
  const row = stmtGet.get(tenantId, namespace, key);
  if (!row) return defaultValue;
  return JSON.parse(row.value);
}

/**
 * Return all keys in the namespace as {key: decodedValue}.
 */
function getNamespace(tenantId, namespace) {
  const rows = stmtGetNs.all(tenantId, namespace);
  return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
}

/**
 * Upsert (tenantId, namespace, key) = value and append a hash-chain history row.
 *
 * @param {string}   tenantId
 * @param {string}   namespace
 * @param {string}   key
 * @param {any}      value        — will be JSON-encoded
 * @param {object}   opts
 * @param {number|null} opts.actorUserId
 * @param {string}   opts.reason  — must be >= 20 characters
 */
function setConfig(tenantId, namespace, key, value, { actorUserId = null, reason } = {}) {
  if (!reason || reason.length < 20) {
    throw new Error(`reason must be at least 20 characters (got ${reason ? reason.length : 0})`);
  }

  _validate(namespace, key, value);

  const encodedValue = JSON.stringify(value);

  // Generate changed_at BEFORE hashing — this is the source of truth for the
  // hash. The INSERT passes this explicit timestamp, overriding any default.
  const changedAt = new Date().toISOString();

  const prev = _prevHash(tenantId, namespace, key);
  const rowDict = {
    changed_at: changedAt,
    changed_by: actorUserId,
    key,
    namespace,
    reason,
    schema_version: 1,
    tenant_id: tenantId,
    value: encodedValue,
  };
  const newHash = _computeHash(prev, rowDict);

  const now = new Date().toISOString();
  const insertBoth = db.transaction(() => {
    stmtUpsert.run(tenantId, namespace, key, encodedValue, actorUserId, now);
    stmtHistory.run(
      tenantId, namespace, key, encodedValue,
      actorUserId, reason, changedAt, prev, newHash,
    );
  });
  insertBoth();

  return { hash: newHash, changed_at: changedAt };
}

module.exports = { getConfig, getNamespace, setConfig };

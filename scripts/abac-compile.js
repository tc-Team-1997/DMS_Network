#!/usr/bin/env node
/**
 * scripts/abac-compile.js
 *
 * Compiles the tenant_config.abac.rules JSON array into a valid Rego policy
 * that replaces opa/policies/dms.rego.
 *
 * Usage (CLI):
 *   node scripts/abac-compile.js [tenant_id]
 *   → reads rules from DB (tenant_config namespace 'abac', key 'rules')
 *   → writes opa/policies/dms.rego atomically
 *
 * Usage (module):
 *   const { compile, writeRegoAtomic } = require('./scripts/abac-compile');
 *   const regoText = compile(rulesArray);   // pure, no I/O
 *   writeRegoAtomic(regoText);              // atomic file write
 *
 * Rule schema (each item in the rules array):
 * {
 *   id:          string   — machine-safe identifier, unique within the array
 *   name:        string   — human label
 *   description: string?  — optional prose
 *   effect:      "allow" | "deny"
 *   priority:    integer  — higher = evaluated first; tie-break: array order
 *   condition: {
 *     resource: "document" | "folder" | "workflow" | "admin" | "*"
 *     action:   string (one of the known action names, or "*" for any)
 *     when_all?: Predicate[]   — AND conjunction
 *     when_any?: Predicate[]   — OR conjunction (at least one must be true)
 *   }
 * }
 *
 * Predicate schema:
 * {
 *   field: one of ALLOWED_FIELDS
 *   op:    "eq" | "neq" | "in" | "not_in" | "gte" | "lte"
 *   value: string | number | boolean | string[]
 * }
 *
 * ALLOWED_FIELDS (closed enum — unknown fields are rejected at compile time):
 *   subject.role
 *   subject.branch
 *   subject.tenant
 *   resource.tenant_id
 *   resource.risk_band
 *   resource.branch
 *   resource.type
 *   context.stepup_valid
 *   context.time_unix
 *   action.name
 *
 * Safety guarantee:
 *   compile() throws if any field path is outside ALLOWED_FIELDS.
 *   writeRegoAtomic() does NOT overwrite the existing file on any thrown error.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT  = path.join(__dirname, '..');
const REGO_PATH  = path.join(REPO_ROOT, 'opa', 'policies', 'dms.rego');

const ALLOWED_FIELDS = new Set([
  'subject.role',
  'subject.branch',
  'subject.tenant',
  'resource.tenant_id',
  'resource.risk_band',
  'resource.branch',
  'resource.type',
  'context.stepup_valid',
  'context.time_unix',
  'action.name',
]);

const ALLOWED_OPS = new Set(['eq', 'neq', 'in', 'not_in', 'gte', 'lte']);

// ---------------------------------------------------------------------------
// Helpers — safe identifier check
// ---------------------------------------------------------------------------

function safeId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    throw new Error(`abac-compile: rule id must be a safe identifier, got: ${JSON.stringify(id)}`);
  }
}

// ---------------------------------------------------------------------------
// Field path → Rego input reference
// ---------------------------------------------------------------------------
// Maps the closed enum of field paths to their Rego equivalents.
// subject.role must use 'some r in input.subject.roles; r == value' form
// because the OPA schema stores roles as an array.

function fieldToRego(field) {
  const map = {
    'subject.role':        null, // special — uses 'some r in input.subject.roles'
    'subject.branch':      'input.subject.branch',
    'subject.tenant':      'input.subject.tenant',
    'resource.tenant_id':  'input.resource.tenant',
    'resource.risk_band':  'input.resource.risk_band',
    'resource.branch':     'input.resource.branch',
    'resource.type':       'input.resource.type',
    'context.stepup_valid':'input.context.stepup_valid',
    'context.time_unix':   'input.context.time_unix',
    'action.name':         'input.action.name',
  };
  if (!(field in map)) {
    throw new Error(`abac-compile: unknown field path: "${field}". Allowed: ${[...ALLOWED_FIELDS].join(', ')}`);
  }
  return map[field];
}

// ---------------------------------------------------------------------------
// Value → Rego literal
// ---------------------------------------------------------------------------

function valueToRego(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number')  return String(value);
  if (typeof value === 'string')  return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `{${value.map(valueToRego).join(', ')}}`;
  }
  throw new Error(`abac-compile: unsupported value type: ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Predicate → Rego line(s)
// ---------------------------------------------------------------------------

function predicateToRego(pred, ruleId) {
  if (!pred || typeof pred !== 'object') {
    throw new Error(`abac-compile: invalid predicate in rule "${ruleId}"`);
  }
  const { field, op, value } = pred;
  if (!ALLOWED_FIELDS.has(field)) {
    throw new Error(`abac-compile: unknown field path "${field}" in rule "${ruleId}". Allowed: ${[...ALLOWED_FIELDS].join(', ')}`);
  }
  if (!ALLOWED_OPS.has(op)) {
    throw new Error(`abac-compile: unknown operator "${op}" in rule "${ruleId}". Allowed: eq, neq, in, not_in, gte, lte`);
  }

  // Special case: subject.role uses the roles array
  if (field === 'subject.role') {
    if (op === 'eq') {
      return [`some __r__ in input.subject.roles`, `__r__ == ${valueToRego(value)}`];
    }
    if (op === 'neq') {
      return [`every __r__ in input.subject.roles { __r__ != ${valueToRego(value)} }`];
    }
    if (op === 'in') {
      // value must be array: "subject.role is one of [...]"
      const setLit = valueToRego(Array.isArray(value) ? value : [value]);
      return [`some __r__ in input.subject.roles`, `${setLit}[__r__]`];
    }
    if (op === 'not_in') {
      const setLit = valueToRego(Array.isArray(value) ? value : [value]);
      return [`every __r__ in input.subject.roles { not ${setLit}[__r__] }`];
    }
    throw new Error(`abac-compile: operator "${op}" not supported for subject.role`);
  }

  const ref = fieldToRego(field);

  switch (op) {
    case 'eq':     return [`${ref} == ${valueToRego(value)}`];
    case 'neq':    return [`${ref} != ${valueToRego(value)}`];
    case 'gte':    return [`${ref} >= ${valueToRego(value)}`];
    case 'lte':    return [`${ref} <= ${valueToRego(value)}`];
    case 'in': {
      const setLit = valueToRego(Array.isArray(value) ? value : [value]);
      return [`${setLit}[${ref}]`];
    }
    case 'not_in': {
      const setLit = valueToRego(Array.isArray(value) ? value : [value]);
      return [`not ${setLit}[${ref}]`];
    }
    default:
      throw new Error(`abac-compile: unknown operator "${op}"`);
  }
}

// ---------------------------------------------------------------------------
// Condition → body lines
// ---------------------------------------------------------------------------

function conditionToBodyLines(condition, ruleId) {
  if (!condition || typeof condition !== 'object') {
    throw new Error(`abac-compile: rule "${ruleId}" missing condition`);
  }

  const lines = [];

  // action filter (skip if '*')
  if (condition.action && condition.action !== '*') {
    lines.push(`input.action.name == ${JSON.stringify(condition.action)}`);
  }

  // resource.type filter (skip if '*' or absent)
  if (condition.resource && condition.resource !== '*') {
    lines.push(`input.resource.type == ${JSON.stringify(condition.resource)}`);
  }

  const whenAll = condition.when_all;
  const whenAny = condition.when_any;

  if (whenAll && whenAll.length > 0) {
    for (const pred of whenAll) {
      for (const line of predicateToRego(pred, ruleId)) {
        lines.push(line);
      }
    }
  }

  if (whenAny && whenAny.length > 0) {
    // Build a helper rule name using the rule id
    // We'll inline the OR as: {fieldA == X} else {fieldB == Y}
    // Rego v1 idiomatic: use a local rule within the block isn't possible inline;
    // instead we generate a helper predicate using disjunction comments.
    // Simplest safe approach: when_any with N predicates generates N complete-definitions
    // for a local boolean helper, then the main rule checks it.
    // Since we're generating top-level rules, we emit the when_any as a
    // separate helper rule block and reference it.
    // The helper name is deterministic from ruleId.
    // This is returned as a separate "preamble" block.
    lines.push(`__any_${ruleId}__`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Rule → Rego block(s)
// ---------------------------------------------------------------------------

function ruleToRego(rule) {
  const { id, name, description, effect, condition } = rule;

  safeId(id);

  if (effect !== 'allow' && effect !== 'deny') {
    throw new Error(`abac-compile: rule "${id}" effect must be "allow" or "deny", got: "${effect}"`);
  }

  const bodyLines = conditionToBodyLines(condition, id);

  const commentLines = [
    `# Rule: ${name || id} (id: ${id})`,
  ];
  if (description) {
    commentLines.push(`# ${description}`);
  }

  const outcome = effect === 'allow'
    ? `{"allow": true, "reason": ${JSON.stringify(id)}}`
    : `{"allow": false, "reason": ${JSON.stringify(id)}}`;

  const blocks = [];

  // If there's a when_any, emit the helper rule first
  const whenAny = condition && condition.when_any;
  if (whenAny && whenAny.length > 0) {
    for (const pred of whenAny) {
      const predLines = predicateToRego(pred, id);
      const helperBody = predLines.map(l => `    ${l}`).join('\n');
      blocks.push(`__any_${id}__ if {\n${helperBody}\n}`);
    }
  }

  const bodyStr = bodyLines.map(l => `    ${l}`).join('\n');
  blocks.push(`${commentLines.join('\n')}\nallow := ${outcome} if {\n${bodyStr}\n}`);

  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// Static header: package + import + defaults + base guards
// Preserves the structural shape of the hand-authored dms.rego.
// The base permissions map and guards remain — custom rules layer on top.
// ---------------------------------------------------------------------------

function staticHeader() {
  return `# Auto-generated from tenant_config.abac.rules. Do not edit by hand.
# Run \`node scripts/abac-compile.js\` to regenerate.
# Generated at: ${new Date().toISOString()}
package dms.authz

import rego.v1

default allow := {"allow": false, "reason": "default_deny"}

# ---------- Role / action base matrix ----------
permissions := {
    "view":        {"viewer", "maker", "checker", "doc_admin", "auditor"},
    "capture":     {"maker", "doc_admin"},
    "index":       {"maker", "doc_admin"},
    "approve":     {"checker", "doc_admin"},
    "sign":        {"checker", "doc_admin"},
    "admin":       {"doc_admin"},
    "audit_read":  {"auditor", "doc_admin"},
}

role_allows if {
    roles := permissions[input.action.name]
    some r in input.subject.roles
    roles[r]
}

# ---------- Tenant isolation ----------
tenant_ok if {
    not input.resource.tenant
}
tenant_ok if {
    input.resource.tenant == input.subject.tenant
}

# ---------- Branch scoping (non-admins/auditors only) ----------
branch_ok if {
    not input.resource.branch
}
branch_ok if {
    some r in input.subject.roles
    r == "doc_admin"
}
branch_ok if {
    some r in input.subject.roles
    r == "auditor"
}
branch_ok if {
    input.resource.branch == input.subject.branch
}

# ---------- Extra guard for critical-risk docs: require step-up context ----------
risk_ok if {
    not input.resource.risk_band
}
risk_ok if {
    input.resource.risk_band != "critical"
}
risk_ok if {
    input.resource.risk_band == "critical"
    input.context.stepup_valid == true
}

# ---------- After-hours guard for sensitive actions ----------
hour := time.clock([input.context.time_unix, "UTC"])[0]
after_hours_ok if {
    not {"admin", "approve", "sign"}[input.action.name]
}
after_hours_ok if {
    some r in input.subject.roles
    r == "doc_admin"
}
after_hours_ok if {
    hour >= 7
    hour < 22
}

# ---------- Base allow rule (survives when no custom rules match) ----------
allow := {"allow": true, "reason": "role+scope+risk"} if {
    role_allows
    tenant_ok
    branch_ok
    risk_ok
    after_hours_ok
}

allow := {"allow": false, "reason": "role_denied"} if {
    not role_allows
}
allow := {"allow": false, "reason": "tenant_mismatch"} if {
    not tenant_ok
}
allow := {"allow": false, "reason": "branch_scope"} if {
    not branch_ok
    role_allows
    tenant_ok
}
allow := {"allow": false, "reason": "critical_risk_needs_stepup"} if {
    role_allows
    tenant_ok
    branch_ok
    not risk_ok
}
allow := {"allow": false, "reason": "after_hours_sensitive_action"} if {
    role_allows
    tenant_ok
    branch_ok
    risk_ok
    not after_hours_ok
}`;
}

// ---------------------------------------------------------------------------
// compile(rules) → regoText  (pure, no I/O)
// ---------------------------------------------------------------------------

/**
 * Compile an array of ABAC rule objects into a Rego policy string.
 * Throws synchronously if any rule is malformed or references an unknown field.
 *
 * @param {object[]} rules
 * @returns {string} — valid Rego policy text
 */
function compile(rules) {
  if (!Array.isArray(rules)) {
    throw new Error('abac-compile: rules must be an array');
  }

  const header = staticHeader();

  if (rules.length === 0) {
    return header + '\n\n# ---------- No custom rules defined ----------\n';
  }

  // Sort descending by priority (higher priority = evaluated first)
  const sorted = [...rules].sort((a, b) => {
    const pa = typeof a.priority === 'number' ? a.priority : 0;
    const pb = typeof b.priority === 'number' ? b.priority : 0;
    return pb - pa;
  });

  // Validate uniqueness of ids
  const ids = new Set();
  for (const r of sorted) {
    safeId(r.id);
    if (ids.has(r.id)) {
      throw new Error(`abac-compile: duplicate rule id "${r.id}"`);
    }
    ids.add(r.id);
  }

  const customBlocks = sorted.map(ruleToRego);

  return [
    header,
    '',
    '# ---------- Custom rules (auto-generated) ----------',
    '',
    ...customBlocks,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// writeRegoAtomic(regoText)
// Write the compiled policy atomically: temp file → rename.
// Does NOT write if regoText was produced by a failed compile() (caller's responsibility).
// ---------------------------------------------------------------------------

/**
 * Atomically write regoText to opa/policies/dms.rego.
 * Uses write-to-temp then rename (POSIX atomic swap).
 *
 * @param {string} regoText
 */
function writeRegoAtomic(regoText) {
  const dir = path.dirname(REGO_PATH);
  const tmpPath = path.join(dir, `dms.rego.tmp.${process.pid}.${Date.now()}`);

  try {
    fs.writeFileSync(tmpPath, regoText, 'utf8');
    fs.renameSync(tmpPath, REGO_PATH);
  } catch (err) {
    // Clean up temp if rename failed
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const tenantId = process.argv[2] || 'nbe';

  let getConfig;
  try {
    ({ getConfig } = require('../db/tenant-config'));
  } catch (err) {
    console.error('abac-compile: cannot load db/tenant-config.js —', err.message);
    console.error('Run from repo root with a seeded database: node db/seed.js');
    process.exit(1);
  }

  let rules;
  try {
    rules = getConfig(tenantId, 'abac', 'rules', []);
  } catch (err) {
    console.error('abac-compile: failed to read rules from DB —', err.message);
    process.exit(1);
  }

  let regoText;
  try {
    regoText = compile(rules);
  } catch (err) {
    console.error('abac-compile: compilation failed —', err.message);
    process.exit(2);
  }

  try {
    writeRegoAtomic(regoText);
  } catch (err) {
    console.error('abac-compile: file write failed —', err.message);
    process.exit(3);
  }

  console.log(`abac-compile: wrote ${REGO_PATH} (${rules.length} custom rule(s) for tenant ${tenantId})`);
  process.exit(0);
}

module.exports = { compile, writeRegoAtomic, REGO_PATH, ALLOWED_FIELDS, ALLOWED_OPS };

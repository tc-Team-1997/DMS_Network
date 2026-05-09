/**
 * ABAC Editor endpoints — admin only, namespace 'abac'.
 *
 * GET    /spa/api/admin/abac/rules         → current rules array for caller's tenant
 * POST   /spa/api/admin/abac/rules         → append a new rule
 * PUT    /spa/api/admin/abac/rules/:id     → replace one rule by id
 * DELETE /spa/api/admin/abac/rules/:id     → remove one rule by id
 * POST   /spa/api/admin/abac/compile       → compile + atomic write + OPA push
 * POST   /spa/api/admin/abac/test          → proxy to Python's POST /api/v1/abac/check
 *
 * RBAC: requireNamespacePermJson('abac') — Doc Admin only (same as all settings namespaces).
 * Config: stored as tenant_config namespace='abac', key='rules' (JSON array).
 * Compile: rules → dms.rego via scripts/abac-compile.js. Atomic write then OPA HTTP push.
 *          On any compile failure: 500, original file untouched, OPA not called.
 *
 * OPA push: PUT {OPA_URL}/v1/policies/dms_authz with raw Rego body.
 *           Fire-and-forget — non-fatal if OPA unreachable. Result logged and returned.
 */

'use strict';

const express = require('express');
const http    = require('http');
const https   = require('https');
const { URL }  = require('url');

const { requireNamespacePermJson, tenantScope } = require('./_shared');
const { getConfig, setConfig }                  = require('../../db/tenant-config');
const { compile, writeRegoAtomic }              = require('../../scripts/abac-compile');

const router = express.Router();
const NS     = 'abac';
const KEY    = 'rules';
const PERM   = requireNamespacePermJson(NS);

// ---------------------------------------------------------------------------
// OPA push (fire-and-forget, non-fatal)
// ---------------------------------------------------------------------------

const OPA_URL  = (process.env.OPA_URL || '').trim();
const PY_BASE  = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001';
const PY_KEY   = process.env.PYTHON_SERVICE_KEY || process.env.API_KEY || 'dev-key-change-me';

/**
 * Push the Rego text to OPA via PUT /v1/policies/dms_authz.
 * Returns a promise that resolves to {ok:bool, status:int|null, error:string|null}.
 * Never rejects — errors are captured and returned.
 */
function pushToOpa(regoText) {
  if (!OPA_URL) {
    return Promise.resolve({ ok: false, status: null, error: 'OPA_URL not configured' });
  }

  return new Promise((resolve) => {
    let url;
    try {
      url = new URL('/v1/policies/dms_authz', OPA_URL);
    } catch (err) {
      return resolve({ ok: false, status: null, error: `Invalid OPA_URL: ${err.message}` });
    }

    const body = Buffer.from(regoText, 'utf8');
    const lib  = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'PUT',
      headers: {
        'Content-Type':   'text/plain',
        'Content-Length': body.length,
      },
    };

    const req = lib.request(opts, (res) => {
      res.resume(); // drain
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      resolve({ ok, status: res.statusCode, error: ok ? null : `OPA returned ${res.statusCode}` });
    });

    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ ok: false, status: null, error: 'OPA push timeout' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, status: null, error: err.message });
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Load and return the current rules array for the caller's tenant. */
function loadRules(tenant) {
  const rules = getConfig(tenant, NS, KEY, []);
  return Array.isArray(rules) ? rules : [];
}

/** Persist the rules array back to tenant_config. */
function saveRules(tenant, rules, actorUserId, reason) {
  return setConfig(tenant, NS, KEY, rules, { actorUserId, reason });
}

/** Validate a single rule object — minimal structural check. */
function validateRule(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return 'rule must be an object';
  }
  if (typeof rule.id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rule.id)) {
    return 'rule.id must be a safe identifier (letters, digits, underscore, not starting with digit)';
  }
  if (typeof rule.name !== 'string' || !rule.name.trim()) {
    return 'rule.name is required';
  }
  if (rule.effect !== 'allow' && rule.effect !== 'deny') {
    return 'rule.effect must be "allow" or "deny"';
  }
  if (typeof rule.priority !== 'number' || !Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > 1000) {
    return 'rule.priority must be an integer 0–1000';
  }
  if (!rule.condition || typeof rule.condition !== 'object') {
    return 'rule.condition is required';
  }
  // Validate predicates reference closed field set — run through compiler
  // (compile throws with a descriptive message on unknown fields)
  try {
    compile([rule]);
  } catch (err) {
    return err.message.replace('abac-compile: ', '');
  }
  return null; // ok
}

// ---------------------------------------------------------------------------
// GET /spa/api/admin/abac/rules
// ---------------------------------------------------------------------------

router.get('/admin/abac/rules', PERM, (req, res) => {
  const tenant = tenantScope(req);
  try {
    const rules = loadRules(tenant);
    return res.json({ rules });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/admin/abac/rules  — add a new rule
// ---------------------------------------------------------------------------

router.post('/admin/abac/rules', PERM, (req, res) => {
  const tenant      = tenantScope(req);
  const userId      = req.session.user.id;
  const { rule, reason } = req.body || {};

  if (!reason || typeof reason !== 'string' || reason.length < 20) {
    return res.status(400).json({ error: 'reason must be at least 20 characters' });
  }

  const validErr = validateRule(rule);
  if (validErr) {
    return res.status(400).json({ error: validErr });
  }

  try {
    const rules = loadRules(tenant);
    if (rules.some(r => r.id === rule.id)) {
      return res.status(409).json({ error: `rule with id "${rule.id}" already exists` });
    }
    const updated = [...rules, rule];
    const result  = saveRules(tenant, updated, userId, reason);
    return res.status(201).json({ rules: updated, hash: result.hash, changed_at: result.changed_at });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /spa/api/admin/abac/rules/:id  — replace one rule
// ---------------------------------------------------------------------------

router.put('/admin/abac/rules/:id', PERM, (req, res) => {
  const tenant      = tenantScope(req);
  const userId      = req.session.user.id;
  const { id }      = req.params;
  const { rule, reason } = req.body || {};

  if (!reason || typeof reason !== 'string' || reason.length < 20) {
    return res.status(400).json({ error: 'reason must be at least 20 characters' });
  }

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id param is required' });
  }

  const validErr = validateRule(rule);
  if (validErr) {
    return res.status(400).json({ error: validErr });
  }

  // id param and rule.id must match
  if (rule.id !== id) {
    return res.status(400).json({ error: `rule.id "${rule.id}" must match path param "${id}"` });
  }

  try {
    const rules = loadRules(tenant);
    const idx   = rules.findIndex(r => r.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: `rule "${id}" not found` });
    }
    const updated = [...rules];
    updated[idx]  = rule;
    const result  = saveRules(tenant, updated, userId, reason);
    return res.json({ rules: updated, hash: result.hash, changed_at: result.changed_at });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /spa/api/admin/abac/rules/:id
// ---------------------------------------------------------------------------

router.delete('/admin/abac/rules/:id', PERM, (req, res) => {
  const tenant  = tenantScope(req);
  const userId  = req.session.user.id;
  const { id }  = req.params;
  const { reason } = req.body || {};

  if (!reason || typeof reason !== 'string' || reason.length < 20) {
    return res.status(400).json({ error: 'reason must be at least 20 characters' });
  }

  try {
    const rules   = loadRules(tenant);
    const updated = rules.filter(r => r.id !== id);
    if (updated.length === rules.length) {
      return res.status(404).json({ error: `rule "${id}" not found` });
    }
    const result = saveRules(tenant, updated, userId, reason);
    return res.json({ rules: updated, hash: result.hash, changed_at: result.changed_at });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/admin/abac/compile
// Compile current rules → dms.rego (atomic write) → push to OPA.
// On compile failure: 500, file untouched, OPA not called.
// ---------------------------------------------------------------------------

router.post('/admin/abac/compile', PERM, async (req, res) => {
  const tenant = tenantScope(req);

  let rules;
  try {
    rules = loadRules(tenant);
  } catch (err) {
    return res.status(500).json({ error: `Failed to load rules: ${err.message}` });
  }

  // Step 1: compile (pure, no I/O) — if this throws, we return 500 immediately
  let regoText;
  try {
    regoText = compile(rules);
  } catch (err) {
    console.error('[abac/compile] compile error:', err.message);
    return res.status(500).json({
      ok: false,
      error: `Compile failed: ${err.message}`,
      opa_push: null,
    });
  }

  // Step 2: atomic file write — if this fails, OPA not called
  try {
    writeRegoAtomic(regoText);
  } catch (err) {
    console.error('[abac/compile] file write error:', err.message);
    return res.status(500).json({
      ok: false,
      error: `File write failed: ${err.message}`,
      opa_push: null,
    });
  }

  // Step 3: push to OPA (fire-and-forget — non-fatal)
  let opaPush = { ok: false, status: null, error: 'OPA_URL not configured' };
  try {
    opaPush = await pushToOpa(regoText);
    if (!opaPush.ok) {
      console.warn('[abac/compile] OPA push non-fatal:', opaPush.error);
    }
  } catch (err) {
    console.warn('[abac/compile] OPA push error (non-fatal):', err.message);
    opaPush = { ok: false, status: null, error: err.message };
  }

  return res.json({
    ok: true,
    rules_compiled: rules.length,
    opa_push: opaPush,
  });
});

// ---------------------------------------------------------------------------
// POST /spa/api/admin/abac/test
// Proxy to Python's POST /api/v1/abac/check
// Body forwarded verbatim: { action, resource?, context? }
// ---------------------------------------------------------------------------

router.post('/admin/abac/test', PERM, (req, res) => {
  const body = req.body || {};

  if (!body.action || typeof body.action !== 'string') {
    return res.status(400).json({ error: 'action is required' });
  }

  const payload = {
    action:   body.action,
    resource: body.resource  || null,
    context:  body.context   || null,
  };

  const bodyStr = JSON.stringify(payload);
  let url;
  try {
    url = new URL('/api/v1/abac/check', PY_BASE);
  } catch (err) {
    return res.status(500).json({ error: `Invalid PYTHON_SERVICE_URL: ${err.message}` });
  }

  const lib  = url.protocol === 'https:' ? https : http;
  const opts = {
    hostname: url.hostname,
    port:     url.port || (url.protocol === 'https:' ? 443 : 80),
    path:     url.pathname,
    method:   'POST',
    headers: {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'X-API-Key':      PY_KEY,
    },
  };

  const pyReq = lib.request(opts, (pyRes) => {
    const chunks = [];
    pyRes.on('data', (c) => chunks.push(c));
    pyRes.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = { raw }; }
      res.status(pyRes.statusCode).json(parsed);
    });
  });

  pyReq.setTimeout(5000, () => {
    pyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Python service timeout', via: 'rbac', allow: false, reason: 'python_timeout' });
    }
  });

  pyReq.on('error', (err) => {
    if (!res.headersSent) {
      // Python unreachable — return a graceful fallback response
      res.status(200).json({ allow: false, via: 'rbac', reason: `python_unreachable:${err.message.slice(0, 60)}` });
    }
  });

  pyReq.write(bodyStr);
  pyReq.end();
});

module.exports = router;

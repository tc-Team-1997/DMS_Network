/**
 * Admin-only tenant configuration endpoints.
 *
 * GET  /spa/api/admin/config/:namespace        → {key: value, …} map for caller's tenant.
 * PUT  /spa/api/admin/config/:namespace        body {key, value, reason} → persisted entry.
 * GET  /spa/api/admin/config-schema/:namespace → JSON Schema for the namespace (static files).
 *
 * RBAC: all three endpoints use requireNamespacePermJson from services/rbac.js.
 *       Today that means Doc Admin only. Future per-namespace grants are a
 *       one-function change in hasNamespacePerm — no handler edits required.
 *
 * Tenant resolution: read from req.session.user.tenant_id via tenantScope().
 */

'use strict';

const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { requireNamespacePermJson, tenantScope } = require('./_shared');
const { getNamespace, setConfig } = require('../../db/tenant-config');

// Repo-root schemas directory (same location db/tenant-config.js reads from).
const SCHEMA_DIR = path.join(__dirname, '..', '..', 'schemas', 'tenant-config');

/**
 * CC6: bust the Python-side provider instance cache when the 'integrations'
 * namespace is written. Fire-and-forget — failure is non-fatal.
 *
 * @param {string}      tenantId
 * @param {string|null} kind  — specific kind (e.g. 'ocr') or null to bust all
 */
function bustProviderCache(tenantId, kind) {
  const pyUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
  const pyKey = process.env.PYTHON_SERVICE_KEY || process.env.API_KEY || '';
  const body = JSON.stringify({ tenant_id: tenantId, kind: kind || null });

  try {
    const url = new URL('/api/v1/admin/integrations/_reset', pyUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-API-Key': pyKey,
      },
    };
    const req = http.request(options, (res) => {
      // Drain response body so the socket is released.
      res.resume();
    });
    req.on('error', (err) => {
      console.warn('[admin-config] provider cache bust failed:', err.message);
    });
    req.setTimeout(3000, () => { req.destroy(); });
    req.write(body);
    req.end();
  } catch (err) {
    console.warn('[admin-config] provider cache bust error:', err.message);
  }
}

const router = express.Router();

/**
 * GET /spa/api/admin/config/:namespace
 * Returns all config key-value pairs for the caller's tenant + namespace.
 * Values are JSON-decoded.
 */
router.get('/admin/config/:namespace', requireNamespacePermJson(null), (req, res) => {
  const tenant = tenantScope(req);
  const { namespace } = req.params;

  if (!namespace || !/^[a-z0-9_-]+$/i.test(namespace)) {
    return res.status(400).json({ error: 'invalid namespace' });
  }

  try {
    const configMap = getNamespace(tenant, namespace);
    return res.json(configMap);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /spa/api/admin/config/:namespace
 * Body: { key: string, value: any, reason: string (>=20 chars) }
 * Returns: { tenant_id, namespace, key, value, hash, changed_at }
 */
router.put('/admin/config/:namespace', requireNamespacePermJson(null), (req, res) => {
  const tenant = tenantScope(req);
  const { namespace } = req.params;
  const userId = req.session.user.id;

  if (!namespace || !/^[a-z0-9_-]+$/i.test(namespace)) {
    return res.status(400).json({ error: 'invalid namespace' });
  }

  const { key, value, reason } = req.body || {};

  if (!key || typeof key !== 'string' || !key.trim()) {
    return res.status(400).json({ error: 'key is required' });
  }
  if (value === undefined) {
    return res.status(400).json({ error: 'value is required' });
  }
  if (!reason || typeof reason !== 'string') {
    return res.status(400).json({ error: 'reason is required' });
  }

  try {
    const result = setConfig(tenant, namespace, key.trim(), value, {
      actorUserId: userId,
      reason,
    });

    // CC6: bust the Python provider cache when an 'integrations' key changes.
    if (namespace === 'integrations') {
      const dotIdx = key.trim().indexOf('.');
      const kind = dotIdx !== -1 ? key.trim().slice(0, dotIdx) : null;
      bustProviderCache(tenant, kind);
    }

    return res.json({
      tenant_id: tenant,
      namespace,
      key: key.trim(),
      value,
      hash: result.hash,
      changed_at: result.changed_at,
    });
  } catch (err) {
    const isValidation = err.message.startsWith('Validation error') ||
                         err.message.startsWith('reason must be') ||
                         err.message.startsWith('validator:');
    return res.status(isValidation ? 400 : 500).json({ error: err.message });
  }
});

/**
 * GET /spa/api/admin/config-schema/:namespace
 * Reads schemas/tenant-config/<namespace>.json and returns it.
 * 404 when no schema file is registered — ConfigPanel shows EmptyState.
 */
router.get('/admin/config-schema/:namespace', requireNamespacePermJson(null), (req, res) => {
  const { namespace } = req.params;

  // Strict allow-list: lowercase letters, digits, underscores, hyphens.
  // Leading underscore is intentional — _tenant_meta is a valid namespace.
  if (!namespace || !/^[a-z_][a-z0-9_-]*$/.test(namespace)) {
    return res.status(400).json({ error: 'invalid_namespace' });
  }

  const schemaPath = path.join(SCHEMA_DIR, `${namespace}.json`);

  // Path-traversal guard: resolved path must stay inside SCHEMA_DIR.
  const resolved = path.resolve(schemaPath);
  const dirResolved = path.resolve(SCHEMA_DIR);
  if (!resolved.startsWith(dirResolved + path.sep) && resolved !== dirResolved) {
    return res.status(400).json({ error: 'invalid_namespace' });
  }

  try {
    const raw = fs.readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(raw);
    return res.json({ namespace, schema });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'schema_not_registered' });
    }
    return res.status(500).json({ error: 'schema_read_failed' });
  }
});

module.exports = router;

/**
 * DSAR Console — Node SPA proxy layer for /spa/api/dsar/*.
 *
 * Every route:
 *   1. Requires a valid session (enforced globally in routes/spa-api.js).
 *   2. Is guarded by requireNamespacePermJson('dsar') — Doc Admin only today;
 *      hasNamespacePerm can be extended per-namespace in services/rbac.js
 *      without touching any handler here.
 *   3. Forwards to Python /api/v1/dsar/* via pyCall() with X-API-Key injected
 *      server-side. The key is NEVER exposed to the browser.
 *
 * Endpoints proxied
 * -----------------
 * GET  /spa/api/dsar/lookup                        → GET  /api/v1/dsar/lookup
 * GET  /spa/api/dsar/subjects/:cid/inventory       → GET  /api/v1/dsar/subjects/:cid/inventory
 * POST /spa/api/dsar/requests                      → POST /api/v1/dsar/requests
 * GET  /spa/api/dsar/requests                      → GET  /api/v1/dsar/requests
 * POST /spa/api/dsar/requests/:id/fulfill          → POST /api/v1/dsar/requests/:id/fulfill
 * POST /spa/api/dsar/requests/:id/release-hold     → POST /api/v1/dsar/requests/:id/release-hold
 *
 * Mounted in routes/spa-api.js.
 */

'use strict';

const express = require('express');
const { pyCall, requireNamespacePermJson, tenantScope } = require('./_shared');

const router = express.Router();

const DSAR_GUARD = requireNamespacePermJson('dsar');

// ---------------------------------------------------------------------------
// Subject lookup
// GET /spa/api/dsar/lookup?axis=cid|email|phone|national_id&value=...
// ---------------------------------------------------------------------------
router.get('/dsar/lookup', DSAR_GUARD, async (req, res) => {
  const { axis, value } = req.query;
  if (!axis || !value) {
    return res.status(400).json({ error: 'axis and value query parameters are required' });
  }
  const VALID_AXES = new Set(['cid', 'email', 'phone', 'national_id']);
  if (!VALID_AXES.has(String(axis))) {
    return res.status(400).json({ error: `axis must be one of: ${[...VALID_AXES].join(', ')}` });
  }
  try {
    const data = await pyCall(`/api/v1/dsar/lookup?axis=${encodeURIComponent(axis)}&value=${encodeURIComponent(value)}`);
    return res.json(data);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message || 'upstream error', detail: err.data });
  }
});

// ---------------------------------------------------------------------------
// Artifact inventory
// GET /spa/api/dsar/subjects/:cid/inventory
// ---------------------------------------------------------------------------
router.get('/dsar/subjects/:cid/inventory', DSAR_GUARD, async (req, res) => {
  const cid = req.params.cid;
  try {
    const data = await pyCall(`/api/v1/dsar/subjects/${encodeURIComponent(cid)}/inventory`);
    return res.json(data);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message || 'upstream error', detail: err.data });
  }
});

// ---------------------------------------------------------------------------
// Create DSAR request
// POST /spa/api/dsar/requests
// ---------------------------------------------------------------------------
router.post('/dsar/requests', DSAR_GUARD, async (req, res) => {
  const { customer_cid, action, regulator, reason, params } = req.body || {};
  if (!customer_cid || !action) {
    return res.status(400).json({ error: 'customer_cid and action are required' });
  }
  const VALID_ACTIONS = new Set([
    'article15_export', 'article17_cryptoshred', 'litigation_hold', 'fulfillment_letter',
  ]);
  if (!VALID_ACTIONS.has(action)) {
    return res.status(400).json({ error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}` });
  }
  try {
    const data = await pyCall('/api/v1/dsar/requests', {
      method: 'POST',
      body: { customer_cid, action, regulator: regulator || null, reason: reason || null, params: params || null },
    });
    return res.status(201).json(data);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message || 'upstream error', detail: err.data });
  }
});

// ---------------------------------------------------------------------------
// List DSAR requests (with SLA timer)
// GET /spa/api/dsar/requests
// ---------------------------------------------------------------------------
router.get('/dsar/requests', DSAR_GUARD, async (req, res) => {
  try {
    const data = await pyCall('/api/v1/dsar/requests');
    return res.json(data);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message || 'upstream error', detail: err.data });
  }
});

// ---------------------------------------------------------------------------
// Fulfill a DSAR request
// POST /spa/api/dsar/requests/:id/fulfill
// ---------------------------------------------------------------------------
router.post('/dsar/requests/:id/fulfill', DSAR_GUARD, async (req, res) => {
  const id = req.params.id;
  try {
    const data = await pyCall(`/api/v1/dsar/requests/${encodeURIComponent(id)}/fulfill`, {
      method: 'POST',
      body: {},
    });
    return res.json(data);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message || 'upstream error', detail: err.data });
  }
});

// ---------------------------------------------------------------------------
// Release litigation hold
// POST /spa/api/dsar/requests/:id/release-hold
// ---------------------------------------------------------------------------
router.post('/dsar/requests/:id/release-hold', DSAR_GUARD, async (req, res) => {
  const id = req.params.id;
  try {
    const data = await pyCall(`/api/v1/dsar/requests/${encodeURIComponent(id)}/release-hold`, {
      method: 'POST',
      body: {},
    });
    return res.json(data);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message || 'upstream error', detail: err.data });
  }
});

module.exports = router;

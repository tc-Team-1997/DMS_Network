/**
 * DSAR Console — Node SPA proxy layer for /spa/api/dsar/*.
 *
 * Every route:
 *   1. Requires a valid session (enforced globally in routes/spa-api.js).
 *   2. Is guarded by requirePermJson('dsar:read') for GETs and dsar:fulfill
 *      for the fulfill / release-hold mutations. The perm keys live in
 *      services/rbac.js (added by Plan 3 / Wave-E1 commit fac2356) and are
 *      mirrored in python-service/app/services/auth.py PERMISSIONS dict.
 *      Bundles: dsar:read → Doc Admin + auditor + compliance.
 *               dsar:fulfill → Doc Admin only.
 *   3. Forwards to Python /api/v1/dsar/* via pyCall() with X-API-Key injected
 *      server-side. The key is NEVER exposed to the browser.
 *   4. Every mutation writes to audit_log via writeAuditRow() with a
 *      policy_decision JSON blob from buildPolicyDecision().
 *
 * Endpoints proxied
 * -----------------
 * GET  /spa/api/dsar/lookup                        → GET  /api/v1/dsar/lookup
 * GET  /spa/api/dsar/subjects/:cid/inventory       → GET  /api/v1/dsar/subjects/:cid/inventory
 * POST /spa/api/dsar/requests                      → POST /api/v1/dsar/requests        (audit: dsar.lookup)
 * GET  /spa/api/dsar/requests                      → GET  /api/v1/dsar/requests        (branch-scoped)
 * GET  /spa/api/dsar/requests/:id/sla              → reads from list                   (Plan 3 — Wave-E1)
 * POST /spa/api/dsar/requests/:id/fulfill          → POST /api/v1/dsar/requests/:id/fulfill (audit: dsar.fulfill; Article 17 double-confirm)
 * POST /spa/api/dsar/requests/:id/release-hold     → POST /api/v1/dsar/requests/:id/release-hold (audit: dsar.release_hold)
 *
 * Mounted in routes/spa-api.js.
 */

'use strict';

const express = require('express');
const { pyCall, requirePermJson, tenantScope, branchScope } = require('./_shared');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');

const router = express.Router();

// Plan 3 (Wave-E1) RBAC keys — landed on main at fac2356.
const DSAR_READ    = requirePermJson('dsar:read');
const DSAR_FULFILL = requirePermJson('dsar:fulfill');

const VALID_ACTIONS = new Set([
  'article15_export', 'article17_cryptoshred', 'litigation_hold', 'fulfillment_letter',
]);

// ---------------------------------------------------------------------------
// Subject lookup
// GET /spa/api/dsar/lookup?axis=cid|email|phone|national_id&value=...
// ---------------------------------------------------------------------------
router.get('/dsar/lookup', DSAR_READ, async (req, res) => {
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
router.get('/dsar/subjects/:cid/inventory', DSAR_READ, async (req, res) => {
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
// Audit: action=dsar.lookup (Plan 3 vocabulary)
// ---------------------------------------------------------------------------
router.post('/dsar/requests', DSAR_READ, async (req, res) => {
  const { customer_cid, action, regulator, reason, params } = req.body || {};
  if (!customer_cid || !action) {
    return res.status(400).json({ error: 'customer_cid and action are required' });
  }
  if (!VALID_ACTIONS.has(action)) {
    return res.status(400).json({ error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}` });
  }
  try {
    const data = await pyCall('/api/v1/dsar/requests', {
      method: 'POST',
      body: { customer_cid, action, regulator: regulator || null, reason: reason || null, params: params || null },
    });

    // Audit: subject-lookup + request-open is the first canonical event in
    // the DSAR fulfillment chain. policy_decision is mandatory per Wave-E DoD.
    writeAuditRow({
      userId:         req.session?.user?.id ?? null,
      action:         'dsar.lookup',
      entity:         'dsar_request',
      entityType:     'dsar_request',
      entityId:       data && data.id != null ? String(data.id) : null,
      detail:         { customer_cid, action, regulator: regulator || null },
      result:         'allow',
      tenantId:       tenantScope(req),
      policyDecision: buildPolicyDecision(req),
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
// Branch-scoped: non-admin Viewer/Maker see only their branch.
// ---------------------------------------------------------------------------
router.get('/dsar/requests', DSAR_READ, async (req, res) => {
  try {
    const branch = branchScope(req.session?.user || {});
    const qs = branch ? `?branch_id=${encodeURIComponent(branch)}` : '';
    const data = await pyCall(`/api/v1/dsar/requests${qs}`);
    return res.json(data);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message || 'upstream error', detail: err.data });
  }
});

// ---------------------------------------------------------------------------
// SLA detail for a single DSAR request (Plan 3 — Wave-E1).
// GET /spa/api/dsar/requests/:id/sla
// Returns { id, sla_due_at, days_remaining, status }. Read-only — no audit row.
// ---------------------------------------------------------------------------
router.get('/dsar/requests/:id/sla', DSAR_READ, async (req, res) => {
  const id = req.params.id;
  try {
    const listData = await pyCall('/api/v1/dsar/requests');
    const items = (listData && listData.items) ? listData.items : (Array.isArray(listData) ? listData : []);
    const row = items.find((r) => String(r.id) === String(id));
    if (!row) return res.status(404).json({ error: 'not_found' });
    const sla_due_at = row.sla_due_at || null;
    const days_remaining = (row.days_remaining != null)
      ? row.days_remaining
      : (sla_due_at ? Math.max(0, Math.ceil((new Date(sla_due_at).getTime() - Date.now()) / 86400000)) : null);
    return res.json({ id: row.id, sla_due_at, days_remaining, status: row.status || null });
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message || 'upstream error', detail: err.data });
  }
});

// ---------------------------------------------------------------------------
// Fulfill a DSAR request
// POST /spa/api/dsar/requests/:id/fulfill
// Body: { kind, reason, destroy_token? }
// Article 17 cryptoshred: require destroy_token === 'DESTROY' (double-confirm).
// Audit: action=dsar.fulfill (Plan 3 vocabulary).
// ---------------------------------------------------------------------------
router.post('/dsar/requests/:id/fulfill', DSAR_FULFILL, async (req, res) => {
  const id = req.params.id;
  const { kind, reason, destroy_token } = req.body || {};

  if (!kind || !VALID_ACTIONS.has(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${[...VALID_ACTIONS].join(', ')}` });
  }
  if (typeof reason !== 'string' || reason.trim().length < 20) {
    return res.status(400).json({ error: 'reason must be a string of at least 20 characters' });
  }
  if (kind === 'article17_cryptoshred' && destroy_token !== 'DESTROY') {
    return res.status(400).json({ error: 'cryptoshred_confirmation_missing' });
  }

  try {
    const data = await pyCall(`/api/v1/dsar/requests/${encodeURIComponent(id)}/fulfill`, {
      method: 'POST',
      body: {},
    });

    writeAuditRow({
      userId:         req.session?.user?.id ?? null,
      action:         'dsar.fulfill',
      entity:         'dsar_request',
      entityType:     'dsar_request',
      entityId:       String(id),
      detail:         { kind, reason, destroy_confirmed: kind === 'article17_cryptoshred' },
      result:         'allow',
      tenantId:       tenantScope(req),
      policyDecision: buildPolicyDecision(req),
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
// Audit: action=dsar.release_hold (Plan 3 vocabulary).
// ---------------------------------------------------------------------------
router.post('/dsar/requests/:id/release-hold', DSAR_FULFILL, async (req, res) => {
  const id = req.params.id;
  try {
    const data = await pyCall(`/api/v1/dsar/requests/${encodeURIComponent(id)}/release-hold`, {
      method: 'POST',
      body: {},
    });

    writeAuditRow({
      userId:         req.session?.user?.id ?? null,
      action:         'dsar.release_hold',
      entity:         'dsar_request',
      entityType:     'dsar_request',
      entityId:       String(id),
      detail:         { released_by: req.session?.user?.username || null },
      result:         'allow',
      tenantId:       tenantScope(req),
      policyDecision: buildPolicyDecision(req),
    });

    return res.json(data);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: err.message || 'upstream error', detail: err.data });
  }
});

module.exports = router;

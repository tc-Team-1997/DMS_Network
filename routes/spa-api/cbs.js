/**
 * CBS (Core Banking System) proxy routes.
 *
 * Mirrors the Python /api/v1/cbs/* surface under /spa/api/cbs/*.
 * RBAC:
 *   health + link-document  → "admin"  (Doc Admin only)
 *   customer pull + accounts → "capture" (Doc Admin, Maker)
 *
 * All calls are forwarded to the Python service via pyCall().
 */
'use strict';

const express = require('express');
const { pyCall, requirePermJson, tenantScope } = require('./_shared');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /spa/api/cbs/health  — admin only
// ---------------------------------------------------------------------------
router.get(
  '/cbs/health',
  requirePermJson('admin'),
  async (req, res) => {
    try {
      const data = await pyCall('/api/v1/cbs/health');
      res.json(data);
    } catch (err) {
      const status = err.status || 502;
      res.status(status).json({ error: err.message, detail: err.data || null });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /spa/api/cbs/customers/:cif  — capture perm
// ---------------------------------------------------------------------------
router.get(
  '/cbs/customers/:cif',
  requirePermJson('capture'),
  async (req, res) => {
    const { cif } = req.params;
    const tenant = tenantScope(req);
    try {
      const data = await pyCall(
        `/api/v1/cbs/customers/${encodeURIComponent(cif)}?tenant_id=${encodeURIComponent(tenant)}`
      );
      res.json(data);
    } catch (err) {
      const status = err.status || 502;
      res.status(status).json({ error: err.message, detail: err.data || null });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /spa/api/cbs/customers/:cif/accounts  — capture perm
// ---------------------------------------------------------------------------
router.get(
  '/cbs/customers/:cif/accounts',
  requirePermJson('capture'),
  async (req, res) => {
    const { cif } = req.params;
    const tenant = tenantScope(req);
    try {
      const data = await pyCall(
        `/api/v1/cbs/customers/${encodeURIComponent(cif)}/accounts?tenant_id=${encodeURIComponent(tenant)}`
      );
      res.json(data);
    } catch (err) {
      const status = err.status || 502;
      res.status(status).json({ error: err.message, detail: err.data || null });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /spa/api/cbs/customers/:cif/link-document  — admin only
// ---------------------------------------------------------------------------
router.post(
  '/cbs/customers/:cif/link-document',
  requirePermJson('admin'),
  async (req, res) => {
    const { cif } = req.params;
    const tenant = tenantScope(req);
    const { document_id } = req.body || {};

    if (!Number.isInteger(document_id)) {
      return res.status(400).json({ error: 'document_id must be an integer' });
    }

    try {
      const data = await pyCall(
        `/api/v1/cbs/customers/${encodeURIComponent(cif)}/link-document?tenant_id=${encodeURIComponent(tenant)}`,
        { method: 'POST', body: { document_id } }
      );
      res.json(data);
    } catch (err) {
      const status = err.status || 502;
      res.status(status).json({ error: err.message, detail: err.data || null });
    }
  }
);

module.exports = router;

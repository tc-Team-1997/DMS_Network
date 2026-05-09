/**
 * Customer-360 — Node SPA mirror of the Python /api/v1/customer360/* surface.
 *
 * All routes:
 *   1. Require a valid session (enforced globally by spa-api.js).
 *   2. Gated by requireNamespacePermJson('customer_360').
 *   3. Proxy to Python via pyCall() — X-API-Key injected server-side.
 *   4. PII reveal endpoint: validates reason ≥ 20 chars in Node before proxying
 *      and writes a local audit_log row.  Python writes its own customer_pii_reveals
 *      row independently for redundancy.
 *
 * Python base path:  /api/v1/customer360/:cid/*
 * Mounted at:        /spa/api/customer360/*  (via routes/spa-api.js)
 */
'use strict';

const express = require('express');
const db = require('../../db');
const { pyCall, requireNamespacePermJson, tenantScope } = require('./_shared');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_REVEAL_REASON = 20;
const ALLOWED_PII_FIELDS = new Set(['phone', 'email', 'national_id', 'dob']);

// ---------------------------------------------------------------------------
// Audit helper (mirrors aml-screening.js pattern)
// ---------------------------------------------------------------------------

function auditLog(userId, action, entity, entityId, details, tenantId) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      action,
      entity,
      entityId,
      JSON.stringify(details),
      tenantId,
    );
  } catch (err) {
    console.error('[customer-360] audit_log insert failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Write a customer_pii_reveals row in the local SQLite DB.
// This is the Node-layer redundant write; Python writes its own row too.
// ---------------------------------------------------------------------------

function writePiiReveal(userId, tenantId, customerCid, fields, reason) {
  try {
    db.prepare(
      `INSERT INTO customer_pii_reveals
         (tenant_id, user_id, customer_cid, fields_json, reason, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).run(tenantId, userId, customerCid, JSON.stringify(fields), reason);
  } catch (err) {
    // Non-fatal: audit write failure must not block the reveal response.
    console.error('[customer-360] customer_pii_reveals insert failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateCid(cid) {
  if (!cid || typeof cid !== 'string' || !cid.trim() || cid.length > 64) {
    return { ok: false, error: 'cid must be a non-empty string ≤ 64 characters' };
  }
  return { ok: true };
}

function paginationParams(query) {
  const limit  = Math.min(parseInt(String(query.limit  ?? 20),  10) || 20,  100);
  const offset = Math.max(parseInt(String(query.offset ?? 0),   10) || 0,   0);
  return { limit, offset };
}

// ---------------------------------------------------------------------------
// GET /spa/api/customer360/:cid
// Header card (9 attributes, masked PII). RBAC: customer_360:read
// ---------------------------------------------------------------------------

router.get('/customer360/:cid', requireNamespacePermJson('customer_360'), async (req, res) => {
  const cidCheck = validateCid(req.params.cid);
  if (!cidCheck.ok) return res.status(400).json({ error: 'validation_failed', details: { cid: cidCheck.error } });

  try {
    const data = await pyCall(`/api/v1/customer360/${encodeURIComponent(req.params.cid)}`, { timeout: 10_000 });
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/customer360/:cid/pii-reveal
// Reveal masked PII fields. Requires reason ≥ 20 chars.
// Writes customer_pii_reveals + audit_log before proxying.
// RBAC: customer_360:read
// ---------------------------------------------------------------------------

router.post('/customer360/:cid/pii-reveal', requireNamespacePermJson('customer_360'), async (req, res) => {
  const cidCheck = validateCid(req.params.cid);
  if (!cidCheck.ok) return res.status(400).json({ error: 'validation_failed', details: { cid: cidCheck.error } });

  const body   = req.body ?? {};
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const fields = Array.isArray(body.fields)
    ? body.fields.filter((f) => typeof f === 'string' && ALLOWED_PII_FIELDS.has(f))
    : [];

  const details = {};
  if (reason.length < MIN_REVEAL_REASON) {
    details.reason = `must be at least ${MIN_REVEAL_REASON} characters`;
  }
  if (fields.length === 0) {
    details.fields = `must include at least one of: ${[...ALLOWED_PII_FIELDS].join(', ')}`;
  }
  if (Object.keys(details).length > 0) {
    return res.status(400).json({ error: 'validation_failed', details });
  }

  const tenant = tenantScope(req);
  const userId = req.session.user.id;
  const cid    = req.params.cid;

  // Write Node-side audit before calling Python (belt + braces)
  writePiiReveal(userId, tenant, cid, fields, reason);
  auditLog(userId, 'CUSTOMER_PII_REVEALED', 'customer', null,
    { cid: cid.slice(0, 6) + '***', fields, reason_len: reason.length },
    tenant);

  try {
    const data = await pyCall(`/api/v1/customer360/${encodeURIComponent(cid)}/pii-reveal`, {
      method: 'POST',
      body:   { fields, reason },
      timeout: 10_000,
    });
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/customer360/:cid/accounts
// RBAC: customer_360:read
// ---------------------------------------------------------------------------

router.get('/customer360/:cid/accounts', requireNamespacePermJson('customer_360'), async (req, res) => {
  const cidCheck = validateCid(req.params.cid);
  if (!cidCheck.ok) return res.status(400).json({ error: 'validation_failed', details: { cid: cidCheck.error } });

  try {
    const data = await pyCall(`/api/v1/customer360/${encodeURIComponent(req.params.cid)}/accounts`, { timeout: 10_000 });
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/customer360/:cid/documents
// RBAC: customer_360:read
// ---------------------------------------------------------------------------

router.get('/customer360/:cid/documents', requireNamespacePermJson('customer_360'), async (req, res) => {
  const cidCheck = validateCid(req.params.cid);
  if (!cidCheck.ok) return res.status(400).json({ error: 'validation_failed', details: { cid: cidCheck.error } });

  const { limit, offset } = paginationParams(req.query);
  try {
    const data = await pyCall(
      `/api/v1/customer360/${encodeURIComponent(req.params.cid)}/documents?limit=${limit}&offset=${offset}`,
      { timeout: 10_000 },
    );
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/customer360/:cid/transactions
// RBAC: customer_360:read
// ---------------------------------------------------------------------------

router.get('/customer360/:cid/transactions', requireNamespacePermJson('customer_360'), async (req, res) => {
  const cidCheck = validateCid(req.params.cid);
  if (!cidCheck.ok) return res.status(400).json({ error: 'validation_failed', details: { cid: cidCheck.error } });

  const { limit, offset } = paginationParams(req.query);
  try {
    const data = await pyCall(
      `/api/v1/customer360/${encodeURIComponent(req.params.cid)}/transactions?limit=${limit}&offset=${offset}`,
      { timeout: 10_000 },
    );
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/customer360/:cid/workflows
// RBAC: customer_360:read
// ---------------------------------------------------------------------------

router.get('/customer360/:cid/workflows', requireNamespacePermJson('customer_360'), async (req, res) => {
  const cidCheck = validateCid(req.params.cid);
  if (!cidCheck.ok) return res.status(400).json({ error: 'validation_failed', details: { cid: cidCheck.error } });

  const { limit, offset } = paginationParams(req.query);
  try {
    const data = await pyCall(
      `/api/v1/customer360/${encodeURIComponent(req.params.cid)}/workflows?limit=${limit}&offset=${offset}`,
      { timeout: 10_000 },
    );
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/customer360/:cid/activity
// RBAC: customer_360:read
// ---------------------------------------------------------------------------

router.get('/customer360/:cid/activity', requireNamespacePermJson('customer_360'), async (req, res) => {
  const cidCheck = validateCid(req.params.cid);
  if (!cidCheck.ok) return res.status(400).json({ error: 'validation_failed', details: { cid: cidCheck.error } });

  const { limit, offset } = paginationParams(req.query);
  try {
    const data = await pyCall(
      `/api/v1/customer360/${encodeURIComponent(req.params.cid)}/activity?limit=${limit}&offset=${offset}`,
      { timeout: 10_000 },
    );
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

module.exports = router;

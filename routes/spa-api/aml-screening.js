/**
 * AML Screening — Node SPA mirror of the Python /api/v1/aml/* surface.
 *
 * Every route:
 *   1. Requires a valid session (enforced globally in routes/spa-api.js before
 *      this router is invoked — no per-handler requireAuthJson needed).
 *   2. Is guarded by one of three RBAC permission slugs:
 *        aml:read   — Viewer, auditor, compliance, Doc Admin
 *        aml:review — compliance, Doc Admin
 *        aml:admin  — Doc Admin only
 *   3. Injects X-API-Key server-side via pyCall(); the key is NEVER returned
 *      to the browser (contract §8 security non-negotiable).
 *   4. Writes an audit_log row for every mutation (try/catch so audit failure
 *      cannot roll back the proxied write that already succeeded on Python).
 *
 * Python base path:  /api/v1/aml/*
 * Mounted at:        /spa/api/aml/*  (via routes/spa-api.js)
 *
 * Contract: docs/contracts/aml-screening.md §5 + task-spec endpoint table.
 */
const express = require('express');
const db = require('../../db');
const { pyCall, requirePermJson, tenantScope } = require('./_shared');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_DECISIONS = new Set(['cleared', 'escalated', 'blocked']);
const CURSOR_MAX_LEN  = 512;   // opaque cursor string upper bound
const LIMIT_MAX       = 200;   // pagination cap

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate and coerce common query-param pagination args.
 * Returns { ok: true, limit, cursor } or { ok: false, details }.
 */
function validatePagination(query) {
  const details = {};

  let limit = 50; // default
  if (query.limit !== undefined) {
    limit = parseInt(String(query.limit), 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > LIMIT_MAX) {
      details.limit = `must be an integer in [1, ${LIMIT_MAX}]`;
    } else {
      limit = limit; // already coerced
    }
  }

  let cursor = null;
  if (query.cursor !== undefined && query.cursor !== '') {
    if (typeof query.cursor !== 'string' || query.cursor.length > CURSOR_MAX_LEN) {
      details.cursor = `must be a string ≤ ${CURSOR_MAX_LEN} characters`;
    } else {
      cursor = query.cursor;
    }
  }

  if (Object.keys(details).length > 0) {
    return { ok: false, details };
  }
  return { ok: true, limit, cursor };
}

/**
 * Validate match_threshold for PATCH /watchlists/:id.
 * Returns { ok: true } or { ok: false, details }.
 */
function validateMatchThreshold(value) {
  if (value === undefined) return { ok: true }; // not supplied — skip
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return { ok: false, details: { match_threshold: 'must be a number in [0, 1]' } };
  }
  return { ok: true };
}

/**
 * Validate the body for POST /hits/:id/decide.
 * Returns { ok: true } or { ok: false, details }.
 */
function validateDecision(body) {
  const details = {};
  if (!body || !VALID_DECISIONS.has(body.decision)) {
    details.decision = `must be one of: ${[...VALID_DECISIONS].join(', ')}`;
  }
  if (body && body.notes !== undefined) {
    if (typeof body.notes !== 'string' || body.notes.length > 2000) {
      details.notes = 'must be a string ≤ 2000 characters';
    }
  }
  if (Object.keys(details).length > 0) return { ok: false, details };
  return { ok: true };
}

/**
 * Validate the body for POST /screen.
 * Returns { ok: true } or { ok: false, details }.
 */
function validateScreen(body) {
  const details = {};
  if (!body || typeof body.customer_cid !== 'string' || !body.customer_cid.trim()) {
    details.customer_cid = 'required, non-empty string';
  } else if (body.customer_cid.length > 64) {
    details.customer_cid = 'must be ≤ 64 characters';
  }
  if (Object.keys(details).length > 0) return { ok: false, details };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

/**
 * Write a row to audit_log. Wrapped in try/catch so a DB failure does not
 * surface as an error to the browser caller or roll back the upstream write.
 *
 * @param {number|null} userId    - req.session.user.id
 * @param {string}      action    - AML_* constant (e.g. 'AML_HIT_DECIDED')
 * @param {string|null} entity    - table name or resource type
 * @param {number|null} entityId  - primary key of the affected row
 * @param {object}      details   - arbitrary structured context (JSON-serialised)
 * @param {string}      tenantId  - from tenantScope(req)
 */
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
  } catch (auditErr) {
    // Non-fatal. Log to stderr but do not propagate.
    console.error('[aml-screening] audit_log insert failed:', auditErr.message);
  }
}

// ---------------------------------------------------------------------------
// Forward query params to the Python URL (only whitelisted keys)
// ---------------------------------------------------------------------------

/**
 * Build a query-string from a whitelisted subset of req.query.
 * Returns a string like '?status=open&limit=50' or '' when empty.
 */
function forwardQuery(reqQuery, allowedKeys) {
  const out = new URLSearchParams();
  for (const key of allowedKeys) {
    const val = reqQuery[key];
    if (val !== undefined && val !== null && val !== '') {
      out.set(key, String(val));
    }
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------------------
// GET /spa/api/aml/watchlists
// List loaded watchlists (name, source_url, last_updated, entry_count).
// RBAC: aml:read
// ---------------------------------------------------------------------------

router.get('/aml/watchlists', requirePermJson('aml:read'), async (req, res) => {
  try {
    const data = await pyCall('/api/v1/aml/watchlists', { timeout: 10_000 });
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/aml/watchlists/refresh
// Trigger async watchlist download + customer re-screen.
// RBAC: aml:admin
// Idempotency-Key header is passed through to Python as-is.
// ---------------------------------------------------------------------------

router.post('/aml/watchlists/refresh', requirePermJson('aml:admin'), async (req, res) => {
  const tenant  = tenantScope(req);
  const userId  = req.session.user.id;

  // Pass Idempotency-Key through if the SPA supplies it.
  const idempotencyKey = req.headers['idempotency-key'] || null;

  try {
    const pyUrl = '/api/v1/aml/watchlists/refresh';
    const callOpts = {
      method: 'POST',
      body:   req.body ?? {},
      timeout: 30_000,
    };
    // Inject the Idempotency-Key as a query param so pyCall (which uses
    // Node's built-in http module and doesn't support arbitrary request header
    // injection beyond X-API-Key) can pass it through.  The Python side
    // accepts it as both a header and a query param per BHU-67 contract.
    const qs = idempotencyKey
      ? `?idempotency_key=${encodeURIComponent(idempotencyKey)}`
      : '';

    const data = await pyCall(`${pyUrl}${qs}`, callOpts);

    auditLog(userId, 'AML_WATCHLIST_REFRESH_TRIGGERED', 'aml_watchlists', null,
      { idempotency_key: idempotencyKey, job_id: data?.job_id ?? null },
      tenant);

    // Python returns 202; mirror that back.
    res.status(202).json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /spa/api/aml/watchlists/:id
// Update a watchlist record (e.g. change match_threshold).
// Validates match_threshold ∈ [0, 1]. Audits AML_WATCHLIST_UPDATED.
// RBAC: aml:admin
// ---------------------------------------------------------------------------

router.patch('/aml/watchlists/:id', requirePermJson('aml:admin'), async (req, res) => {
  const id     = parseInt(req.params.id, 10);
  const tenant = tenantScope(req);
  const userId = req.session.user.id;

  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'validation_failed', details: { id: 'must be a positive integer' } });
  }

  const body = req.body ?? {};

  // Validate match_threshold when present.
  if ('match_threshold' in body) {
    const check = validateMatchThreshold(body.match_threshold);
    if (!check.ok) {
      return res.status(400).json({ error: 'validation_failed', details: check.details });
    }
  }

  if (Object.keys(body).length === 0) {
    return res.status(400).json({ error: 'validation_failed', details: { body: 'no fields supplied' } });
  }

  try {
    const data = await pyCall(`/api/v1/aml/watchlists/${id}`, {
      method:  'PATCH',
      body,
      timeout: 10_000,
    });

    auditLog(userId, 'AML_WATCHLIST_UPDATED', 'aml_watchlists', id,
      { watchlist_id: id, patch: body },
      tenant);

    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/aml/screen
// Enqueue a screening for a customer. Audits AML_SCREENING_TRIGGERED.
// Body: { customer_cid: string, ... }
// Python returns synchronously with { status: "pending" } when async or
// { screening_id, ... } when fast. Returns 202 on "pending".
// RBAC: aml:review
// ---------------------------------------------------------------------------

router.post('/aml/screen', requirePermJson('aml:review'), async (req, res) => {
  const tenant = tenantScope(req);
  const userId = req.session.user.id;
  const body   = req.body ?? {};

  const check = validateScreen(body);
  if (!check.ok) {
    return res.status(400).json({ error: 'validation_failed', details: check.details });
  }

  try {
    const data = await pyCall('/api/v1/aml/screen', {
      method:  'POST',
      body,
      timeout: 5_000,   // fire-and-forget; Python returns pending immediately
    });

    auditLog(userId, 'AML_SCREENING_TRIGGERED', 'aml_screenings', data?.screening_id ?? null,
      { customer_cid: body.customer_cid, screening_id: data?.screening_id ?? null },
      tenant);

    // If Python signals the job is still queued, mirror 202 Accepted.
    const httpStatus = (data && data.status === 'pending') ? 202 : 200;
    res.status(httpStatus).json(data);
  } catch (err) {
    // Timeout from Python side is treated as 202 Accepted (fire-and-forget).
    if (err.message === 'python timeout') {
      auditLog(userId, 'AML_SCREENING_TRIGGERED', 'aml_screenings', null,
        { customer_cid: body.customer_cid, note: 'upstream_timeout_treated_as_pending' },
        tenant);
      return res.status(202).json({ status: 'pending', note: 'screening enqueued' });
    }
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/aml/screenings
// List screenings with pagination.
// Allowed query params: status, customer_cid, from_ts, to_ts, cursor, limit
// RBAC: aml:read
// ---------------------------------------------------------------------------

router.get('/aml/screenings', requirePermJson('aml:read'), async (req, res) => {
  const pageCheck = validatePagination(req.query);
  if (!pageCheck.ok) {
    return res.status(400).json({ error: 'validation_failed', details: pageCheck.details });
  }

  const qs = forwardQuery(req.query, ['status', 'customer_cid', 'from_ts', 'to_ts', 'cursor', 'limit']);
  try {
    const data = await pyCall(`/api/v1/aml/screenings${qs}`, { timeout: 15_000 });
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/aml/screenings/:id
// Single screening detail (hits, decisions, timeline).
// RBAC: aml:read
// ---------------------------------------------------------------------------

router.get('/aml/screenings/:id', requirePermJson('aml:read'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'validation_failed', details: { id: 'must be a positive integer' } });
  }

  try {
    const data = await pyCall(`/api/v1/aml/screenings/${id}`, { timeout: 10_000 });
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/aml/hits
// List open (or filtered) hits.
// Allowed query params: decision, cursor, limit
// RBAC: aml:read
// ---------------------------------------------------------------------------

router.get('/aml/hits', requirePermJson('aml:read'), async (req, res) => {
  const pageCheck = validatePagination(req.query);
  if (!pageCheck.ok) {
    return res.status(400).json({ error: 'validation_failed', details: pageCheck.details });
  }

  const qs = forwardQuery(req.query, ['decision', 'cursor', 'limit']);
  try {
    const data = await pyCall(`/api/v1/aml/hits${qs}`, { timeout: 10_000 });
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/aml/hits/:id/decide
// Record a compliance decision on a hit. Audits AML_HIT_DECIDED.
// Body: { decision: 'cleared'|'escalated'|'blocked', notes?: string }
// RBAC: aml:review
// ---------------------------------------------------------------------------

router.post('/aml/hits/:id/decide', requirePermJson('aml:review'), async (req, res) => {
  const id     = parseInt(req.params.id, 10);
  const tenant = tenantScope(req);
  const userId = req.session.user.id;

  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'validation_failed', details: { id: 'must be a positive integer' } });
  }

  const body  = req.body ?? {};
  const check = validateDecision(body);
  if (!check.ok) {
    return res.status(400).json({ error: 'validation_failed', details: check.details });
  }

  // Build a clean body — only forward known fields, strip any extras.
  const pyBody = { decision: body.decision };
  if (typeof body.notes === 'string') pyBody.reviewer_notes = body.notes.slice(0, 2000);

  try {
    const data = await pyCall(`/api/v1/aml/hits/${id}/decide`, {
      method:  'POST',
      body:    pyBody,
      timeout: 10_000,
    });

    auditLog(userId, 'AML_HIT_DECIDED', 'aml_hits', id,
      { hit_id: id, decision: body.decision, notes: body.notes ?? null },
      tenant);

    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/aml/summary
// Compliance card data: last_24h counts + last_run_at. The SPA's AmlSummaryCard
// reads { last_24h: { screenings_count, hit_count, open_hit_count }, last_run_at }.
// Maps directly to Python GET /api/v1/aml/summary (NOT /stats — those return
// different shapes; /stats is broader telemetry, /summary is the card payload).
// RBAC: aml:read
// ---------------------------------------------------------------------------

router.get('/aml/summary', requirePermJson('aml:read'), async (req, res) => {
  try {
    const data = await pyCall('/api/v1/aml/summary', { timeout: 10_000 });
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  }
});

module.exports = router;

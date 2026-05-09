/**
 * CBS (Core Banking System / Temenos T24) proxy routes.
 *
 * Mirrors the Python /api/v1/cbs/* surface under /spa/api/cbs/*.
 * Session auth is enforced globally in routes/spa-api.js before this router
 * is invoked — no per-handler requireAuthJson needed (health is open to any
 * authenticated user per contract §5, all other routes require RBAC).
 *
 * RBAC slugs (defined in services/rbac.js):
 *   cbs:read  — Doc Admin, Maker, Checker, Viewer, auditor, compliance
 *   cbs:write — Doc Admin, Maker, Checker
 *   cbs:admin — Doc Admin only
 *
 * Security non-negotiables (contract docs/contracts/temenos-cbs-adapter.md §8):
 *   - X-API-Key is injected server-side by pyCall(). Never exposed to browser.
 *   - CIF is masked to first-3 + last-3 chars in all audit_log rows.
 *   - Idempotency-Key is forwarded as ?idempotency_key=<val> query param because
 *     pyCall() (Node built-in http module) does not support arbitrary header
 *     injection beyond X-API-Key. Python accepts both header and query param
 *     per the AML precedent. WORKAROUND: if pyCall ever gains header-injection
 *     support, switch to header delivery and remove the qs construction below.
 *   - Upstream timeout is 8 seconds (Temenos calls can be slow). On timeout:
 *     504 { error: "upstream_timeout" } (contract §5, §9.1 budget 800ms p99).
 *   - The `raw` field is stripped from all customer/account responses before
 *     reaching the browser (contract §5: "Never includes the `raw` field").
 *
 * Wire-shape note (for python-engineer sync):
 *   Python deployed REST-style paths at /api/v1/cbs/customers/{cif} (GET),
 *   /api/v1/cbs/customers/{cif}/accounts (GET), and
 *   /api/v1/cbs/customers/{cif}/link-document (POST).
 *   These align exactly with our Node SPA mirror. Two paths are not yet on
 *   Python: GET /api/v1/cbs/accounts/{account_id} and
 *   POST /api/v1/cbs/customers/{cif}/invalidate-cache. Node wires them now;
 *   they activate automatically when Python ships them.
 *   Python's LinkDocumentRequest only requires { document_id }; Node validates
 *   transaction_ref and transaction_type for the audit trail but does NOT
 *   forward them to Python (they are audit-only fields at the Node layer).
 */
'use strict';

const express = require('express');
const db      = require('../../db');
const { pyCall, requirePermJson, tenantScope } = require('./_shared');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants / validation
// ---------------------------------------------------------------------------

// CIF: uppercase alphanumeric only, 1-64 chars.
// Python Pydantic enforces the stricter /^[A-Z0-9]{4,16}$/ at its boundary.
// Node accepts 1-64 so manual smoke tests with "CIF001" style IDs work.
const CIF_RE = /^[A-Z0-9]{1,64}$/;

const TRANSACTION_TYPES = new Set([
  'kyc-update',
  'loan-application',
  'account-opening',
  'compliance-review',
]);

const UPSTREAM_TIMEOUT = 8_000; // 8 s — Temenos can be slow (contract §9.1)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a CIF for audit log storage (banking PII rule — contract §8).
 * "CIF001"   -> "CIF***01"  (first 3 + stars + last 3)
 * Short values (<= 6 chars) are fully masked to prevent reverse-engineering.
 */
function maskCif(cif) {
  if (typeof cif !== 'string') return '***';
  if (cif.length <= 6) return '*'.repeat(cif.length);
  return cif.slice(0, 3) + '*'.repeat(cif.length - 6) + cif.slice(-3);
}

/**
 * Strip the `raw` field from any object (or array of objects) before sending
 * to the browser. Contract §5 + §8: "Never includes the `raw` field".
 */
function stripRaw(data) {
  if (Array.isArray(data)) return data.map(stripRaw);
  if (data && typeof data === 'object') {
    const { raw: _raw, ...rest } = data; // eslint-disable-line no-unused-vars
    return rest;
  }
  return data;
}

/**
 * Write a row to audit_log. Wrapped in try/catch so a DB failure does not
 * surface as an error to the browser or roll back the upstream write that
 * already succeeded on Python. Mirrors the pattern in aml-screening.js.
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
    console.error('[cbs] audit_log insert failed:', auditErr.message);
  }
}

/**
 * Validate a CIF path parameter.
 * Returns { ok: true } or { ok: false, details }.
 */
function validateCif(cif) {
  if (typeof cif !== 'string' || !cif.trim()) {
    return { ok: false, details: { cif: 'required, non-empty string' } };
  }
  if (cif.length > 64) {
    return { ok: false, details: { cif: 'must be <= 64 characters' } };
  }
  if (!CIF_RE.test(cif)) {
    return { ok: false, details: { cif: 'must match ^[A-Z0-9]+$ (uppercase alphanumeric only)' } };
  }
  return { ok: true };
}

/**
 * Translate a pyCall timeout or upstream HTTP error into a response and
 * always return true so callers can write `return handleUpstreamError(...)`.
 */
function handleUpstreamError(err, res) {
  if (err.message === 'python timeout') {
    res.status(504).json({ error: 'upstream_timeout' });
    return true;
  }
  const status = err.status || 502;
  res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
  return true;
}

// ---------------------------------------------------------------------------
// GET /spa/api/cbs/health
//
// Open to any authenticated user (no extra RBAC slug required).
// Used by the ops dashboard health indicator and the footer HealthBadge.
// Contract §5 table: perm = none.
// Python path: GET /api/v1/cbs/health
// ---------------------------------------------------------------------------

router.get('/cbs/health', async (req, res) => {
  try {
    const data = await pyCall('/api/v1/cbs/health', { timeout: UPSTREAM_TIMEOUT });
    res.json(data);
  } catch (err) {
    if (err.message === 'python timeout') {
      return res.status(504).json({ error: 'upstream_timeout' });
    }
    // Surface upstream body so the ops dashboard shows the circuit-breaker detail.
    const status = err.status || 502;
    res.status(status).json(err.data ?? { ok: false, detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/cbs/customers/:cif
//
// Fetch customer master record from T24.
// Passes `stale` / `cached_at` flags through unchanged — the SPA renders a
// yellow warning banner when stale=true (contract §5, §11 "503 with cache").
// Strips `raw` field before responding (contract §5, §8).
// RBAC: cbs:read
// Python path: GET /api/v1/cbs/customers/{cif}
// ---------------------------------------------------------------------------

router.get('/cbs/customers/:cif', requirePermJson('cbs:read'), async (req, res) => {
  const { cif } = req.params;
  const cifCheck = validateCif(cif);
  if (!cifCheck.ok) {
    return res.status(400).json({ error: 'validation_failed', details: cifCheck.details });
  }

  try {
    const data = await pyCall(
      `/api/v1/cbs/customers/${encodeURIComponent(cif)}`,
      { timeout: UPSTREAM_TIMEOUT },
    );
    // Pass stale/cached_at through; strip raw (contract §5 + §8).
    res.json(stripRaw(data));
  } catch (err) {
    return handleUpstreamError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/cbs/customers/:cif/accounts
//
// Fetch the account list for a customer from T24.
// RBAC: cbs:read
// Python path: GET /api/v1/cbs/customers/{cif}/accounts
// ---------------------------------------------------------------------------

router.get('/cbs/customers/:cif/accounts', requirePermJson('cbs:read'), async (req, res) => {
  const { cif } = req.params;
  const cifCheck = validateCif(cif);
  if (!cifCheck.ok) {
    return res.status(400).json({ error: 'validation_failed', details: cifCheck.details });
  }

  try {
    const data = await pyCall(
      `/api/v1/cbs/customers/${encodeURIComponent(cif)}/accounts`,
      { timeout: UPSTREAM_TIMEOUT },
    );
    // stripRaw handles both array and object responses.
    res.json(stripRaw(data));
  } catch (err) {
    return handleUpstreamError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/cbs/accounts/:account_id
//
// Fetch a single account record by account ID.
// RBAC: cbs:read
// Python path: GET /api/v1/cbs/accounts/{account_id}
// Note: not yet deployed on Python as of Phase 2 cutover. Node wires it now;
// it activates automatically when python-engineer ships it.
// ---------------------------------------------------------------------------

router.get('/cbs/accounts/:account_id', requirePermJson('cbs:read'), async (req, res) => {
  const { account_id } = req.params;

  if (typeof account_id !== 'string' || !account_id.trim()) {
    return res.status(400).json({ error: 'validation_failed', details: { account_id: 'required' } });
  }
  if (account_id.length > 64) {
    return res.status(400).json({ error: 'validation_failed', details: { account_id: 'must be <= 64 characters' } });
  }

  try {
    const data = await pyCall(
      `/api/v1/cbs/accounts/${encodeURIComponent(account_id)}`,
      { timeout: UPSTREAM_TIMEOUT },
    );
    res.json(stripRaw(data));
  } catch (err) {
    return handleUpstreamError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/cbs/customers/:cif/link-document
//
// Link an approved DMS document to the customer's T24 record.
// Writes audit row CBS_DOCUMENT_LINKED with masked CIF (contract §8 PII rule).
//
// Idempotency-Key header workaround: pyCall does not support forwarding
// arbitrary request headers. Pass as ?idempotency_key= query param. Python
// CBS router accepts both forms. See module header for the rationale.
//
// Required body: { document_id: <positive integer>, transaction_ref: string }
// Optional body: { transaction_type: one of TRANSACTION_TYPES }
//
// Python's LinkDocumentRequest only requires { document_id }. Node validates
// transaction_ref and transaction_type for audit purposes but does NOT forward
// them to Python — they are audit-only fields at the Node layer. This is an
// intentional layering decision per contract §5 "no wire-shape divergence"
// principle: we forward exactly what Python expects, nothing more.
//
// RBAC: cbs:write
// Python path: POST /api/v1/cbs/customers/{cif}/link-document
// ---------------------------------------------------------------------------

router.post('/cbs/customers/:cif/link-document', requirePermJson('cbs:write'), async (req, res) => {
  const { cif } = req.params;
  const cifCheck = validateCif(cif);
  if (!cifCheck.ok) {
    return res.status(400).json({ error: 'validation_failed', details: cifCheck.details });
  }

  const body       = req.body ?? {};
  const errDetails = {};

  // document_id: required positive integer
  const docId = parseInt(body.document_id, 10);
  if (!Number.isFinite(docId) || docId <= 0) {
    errDetails.document_id = 'required, must be a positive integer';
  }

  // transaction_ref: required non-empty string <= 128 chars
  if (typeof body.transaction_ref !== 'string' || !body.transaction_ref.trim()) {
    errDetails.transaction_ref = 'required, non-empty string';
  } else if (body.transaction_ref.length > 128) {
    errDetails.transaction_ref = 'must be <= 128 characters';
  }

  // transaction_type: optional enum
  if (body.transaction_type !== undefined && body.transaction_type !== null) {
    if (!TRANSACTION_TYPES.has(body.transaction_type)) {
      errDetails.transaction_type =
        `must be one of: ${[...TRANSACTION_TYPES].join(', ')}`;
    }
  }

  if (Object.keys(errDetails).length > 0) {
    return res.status(400).json({ error: 'validation_failed', details: errDetails });
  }

  const tenant         = tenantScope(req);
  const userId         = req.session.user.id;
  const idempotencyKey = req.headers['idempotency-key'] || null;

  // Python's LinkDocumentRequest now accepts optional transaction_ref +
  // transaction_type so the audit context reaches cbs_document_links —
  // not just audit_log. Closes the wire-shape divergence flagged in the
  // 2026-05-09 security review.
  const pyBody = {
    document_id: docId,
    transaction_ref: body.transaction_ref.trim(),
    ...(body.transaction_type ? { transaction_type: body.transaction_type } : {}),
  };

  // Idempotency-Key workaround: pass as query param (pyCall limitation).
  // Switch to header forwarding if pyCall gains that capability.
  const qs = idempotencyKey
    ? `?idempotency_key=${encodeURIComponent(idempotencyKey)}`
    : '';

  try {
    const data = await pyCall(
      `/api/v1/cbs/customers/${encodeURIComponent(cif)}/link-document${qs}`,
      { method: 'POST', body: pyBody, timeout: UPSTREAM_TIMEOUT },
    );

    // Audit — mask CIF per contract §8 banking PII rule.
    auditLog(
      userId,
      'CBS_DOCUMENT_LINKED',
      'cbs_links',
      data?.doc_id ?? docId,
      {
        cif:              maskCif(cif),
        document_id:      docId,
        transaction_ref:  body.transaction_ref.trim(),
        transaction_type: body.transaction_type ?? null,
        idempotency_key:  idempotencyKey,
      },
      tenant,
    );

    res.json(data);
  } catch (err) {
    return handleUpstreamError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/cbs/customers/:cif/invalidate-cache
//
// Invalidate the server-side customer master cache for a given CIF.
// Writes audit row CBS_CACHE_INVALIDATED with masked CIF (contract §8).
// RBAC: cbs:admin (Doc Admin only — privileged cache management operation)
// Python path: POST /api/v1/cbs/customers/{cif}/invalidate-cache
// Note: not yet deployed on Python as of Phase 2 cutover. Node wires it now;
// it activates automatically when python-engineer ships it.
// ---------------------------------------------------------------------------

router.post('/cbs/customers/:cif/invalidate-cache', requirePermJson('cbs:admin'), async (req, res) => {
  const { cif } = req.params;
  const cifCheck = validateCif(cif);
  if (!cifCheck.ok) {
    return res.status(400).json({ error: 'validation_failed', details: cifCheck.details });
  }

  const body   = req.body ?? {};
  const tenant = tenantScope(req);
  const userId = req.session.user.id;

  try {
    const data = await pyCall(
      `/api/v1/cbs/customers/${encodeURIComponent(cif)}/invalidate-cache`,
      { method: 'POST', body: { reason: body.reason ?? null }, timeout: UPSTREAM_TIMEOUT },
    );

    // Audit — mask CIF per contract §8 banking PII rule.
    auditLog(
      userId,
      'CBS_CACHE_INVALIDATED',
      'cbs_customer_cache',
      null,
      { cif: maskCif(cif), reason: body.reason ?? null },
      tenant,
    );

    res.json(data);
  } catch (err) {
    return handleUpstreamError(err, res);
  }
});

module.exports = router;

/**
 * Face Match KYC — Node SPA proxy (BHU-9, DPIA: high risk / biometric PII).
 *
 * Mirrors Python /api/v1/face-match/* under /spa/api/face-match/*.
 * Session auth is enforced globally in routes/spa-api.js before this router.
 *
 * RBAC:
 *   kyc:write — maker, doc_admin  (POST /spa/api/face-match)
 *   kyc:read  — auditor, doc_admin (GET /spa/api/face-match/:id)
 *   (open to any authed user)      (GET /spa/api/face-match/consent-template)
 *   (open to any authed user)      (POST /spa/api/face-match/consent-token)
 *
 * Security non-negotiables:
 *   - Raw image bytes are NEVER buffered in Node memory. Photos are streamed
 *     directly to the Python service using http.request pipe.
 *   - Audit log records customer_cid (masked to first-3+***+last-3), match
 *     result, distance. NEVER logs image bytes, face encodings, or the full CID.
 *   - X-API-Key is injected server-side by stream proxy. Never exposed to browser.
 *   - The consent_token field is a JWT opaque to Node — forwarded as-is.
 *   - Feature flag FF_FACE_MATCH_KYC: if Python returns 501, Node passes it through.
 *
 * Stream proxy design (multipart/form-data):
 *   Node uses http.request() to stream the incoming multipart body directly
 *   to Python without materialising the entire payload in memory. This keeps
 *   memory usage at O(chunk-size) instead of O(file-size) per request.
 *   Max 5 MB per photo is enforced at the Python layer; Node does not re-validate
 *   file size to avoid double-reading the stream.
 *
 * Tables involved: audit_log (Node SQLite write). Biometric tables are Python-only.
 *
 * Wire-shape: Python API returns { match, distance, confidence, face_geometry_ok,
 *   detail, decision_at, idempotency_key }. Node passes through unchanged.
 */

'use strict';

const http    = require('http');
const https   = require('https');
const { URL } = require('url');
const db      = require('../../db');
const { requirePermJson, tenantScope } = require('./_shared');

const router = require('express').Router();

const PY_BASE = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001';
const PY_KEY  = process.env.PYTHON_SERVICE_KEY  || 'dev-key-change-me';

// Face match calls include CPU-bound dlib inference (p99 ≤ 2s budget) plus
// network overhead. Use a 10s timeout with headroom.
const FACE_MATCH_TIMEOUT = 10_000;
// Lightweight metadata calls can be faster.
const METADATA_TIMEOUT = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a customer CID for audit log storage (PII rule — never log full CID).
 * "CIF001"  → "CIF***01" (first 3 + stars + last 3)
 * Short values (<= 6 chars) are fully masked.
 */
function maskCid(cid) {
  if (typeof cid !== 'string') return '***';
  if (cid.length <= 6) return '*'.repeat(cid.length);
  return cid.slice(0, 3) + '*'.repeat(cid.length - 6) + cid.slice(-3);
}

/**
 * Write a FACE_MATCH_PERFORMED row to audit_log.
 * Only logs masked CID, match result, and distance.
 * NEVER logs image bytes, face encodings, or consent token body.
 */
function auditLog(userId, customerCid, matchResult, distance, tenantId) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      'FACE_MATCH_PERFORMED',
      'biometric_match',
      null,
      JSON.stringify({
        customer_cid: maskCid(customerCid),   // NEVER the full CID
        match:        matchResult,
        distance:     typeof distance === 'number' ? Math.round(distance * 10000) / 10000 : null,
        // image bytes, encodings, consent token body are NEVER logged
      }),
      tenantId,
    );
  } catch (auditErr) {
    // Non-fatal — audit failure must not block the response.
    console.error('[face-match] audit_log insert failed:', auditErr.message);
  }
}

/**
 * Stream-proxy a multipart request to Python without buffering the entire body.
 *
 * express.raw() (or multer) is NOT used here — the raw incoming stream is piped
 * directly to the Python request. This keeps memory usage minimal for 5 MB photos.
 *
 * req.headers['content-type'] is forwarded unchanged so Python's multipart
 * parser receives the correct boundary parameter.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {string}  pyPath   — e.g. '/api/v1/face-match'
 * @param {number}  timeout  — ms
 */
function streamProxy(req, res, pyPath, timeout) {
  const target = new URL(pyPath, PY_BASE);
  const lib    = target.protocol === 'https:' ? https : http;

  const proxyOpts = {
    method:  req.method,
    headers: {
      'X-API-Key':     PY_KEY,
      'Content-Type':  req.headers['content-type'] || 'multipart/form-data',
      'Accept':        'application/json',
      // Forward content-length if present (avoids chunked encoding when size is known)
      ...(req.headers['content-length']
        ? { 'Content-Length': req.headers['content-length'] }
        : {}),
    },
  };

  const proxyReq = lib.request(target, proxyOpts, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', (c) => chunks.push(c));
    proxyRes.on('end', () => {
      const raw    = Buffer.concat(chunks).toString('utf-8');
      let   parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
      res.status(proxyRes.statusCode).json(parsed);
    });
  });

  proxyReq.setTimeout(timeout, () => {
    proxyReq.destroy(new Error('face_match_timeout'));
    if (!res.headersSent) {
      res.status(504).json({ error: 'upstream_timeout', message: 'Face match timed out.' });
    }
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      if (err.message === 'face_match_timeout') return;
      res.status(502).json({ error: 'proxy_error', detail: err.message });
    }
  });

  // Pipe incoming body directly — no buffering.
  req.pipe(proxyReq);
}

/**
 * JSON-only proxy for non-multipart endpoints (consent-template, consent-token,
 * GET match record). Uses the shared pyCall pattern but keeps it local so we
 * can set a FACE_MATCH_TIMEOUT without touching _shared.js.
 */
function jsonProxy(subpath, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(subpath, PY_BASE);
    const lib    = target.protocol === 'https:' ? https : http;
    const opts   = {
      method,
      headers: {
        'X-API-Key':    PY_KEY,
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
    };
    const req = lib.request(target, opts, (pyRes) => {
      const chunks = [];
      pyRes.on('data', (c) => chunks.push(c));
      pyRes.on('end', () => {
        const raw  = Buffer.concat(chunks).toString('utf-8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        if (pyRes.statusCode >= 200 && pyRes.statusCode < 300) return resolve(parsed);
        const err = new Error(`python ${pyRes.statusCode}`);
        err.status = pyRes.statusCode;
        err.data   = parsed;
        reject(err);
      });
    });
    req.on('error', reject);
    req.setTimeout(METADATA_TIMEOUT, () => { req.destroy(new Error('timeout')); });
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

function handleUpstreamError(err, res) {
  if (err.message === 'timeout') {
    return res.status(504).json({ error: 'upstream_timeout' });
  }
  const status = err.status || 502;
  res.status(status).json(err.data ?? { error: 'proxy_error', detail: err.message });
}

// ---------------------------------------------------------------------------
// GET /spa/api/face-match/consent-template
//
// Public to any authenticated session user. No RBAC slug required.
// Python: GET /api/v1/face-match/consent-template
// ---------------------------------------------------------------------------

router.get('/face-match/consent-template', async (req, res) => {
  try {
    const data = await jsonProxy('/api/v1/face-match/consent-template');
    res.json(data);
  } catch (err) {
    return handleUpstreamError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/face-match/consent-token
//
// Issue a consent JWT. Open to any authenticated session user (mobile calls
// Python directly; this path is for web SPA).
// Python: POST /api/v1/face-match/consent-token
// ---------------------------------------------------------------------------

router.post('/face-match/consent-token', async (req, res) => {
  const body = req.body ?? {};

  if (!body.customer_cid || typeof body.customer_cid !== 'string') {
    return res.status(400).json({ error: 'validation_failed', details: { customer_cid: 'required' } });
  }

  try {
    const data = await jsonProxy('/api/v1/face-match/consent-token', {
      method: 'POST',
      body: {
        customer_cid: body.customer_cid,
        signed_at:    body.signed_at    || new Date().toISOString(),
        signature:    body.signature    || null,
      },
    });
    res.status(201).json(data);
  } catch (err) {
    return handleUpstreamError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/face-match
//
// Stream-proxy the multipart upload to Python.
// Photos flow through Node as a stream — never buffered entirely in memory.
// After Python responds, write the audit log row.
// RBAC: kyc:write
// Python: POST /api/v1/face-match
// ---------------------------------------------------------------------------

router.post('/face-match', requirePermJson('kyc:write'), (req, res) => {
  const tenant   = tenantScope(req);
  const userId   = req.session.user.id;

  // Extract customer_cid from query param for audit log (it arrives in the
  // multipart body at the Python layer — we accept it as a query param here
  // so the audit log can record it without parsing the stream).
  // The Python service validates it as a required Form field.
  const customerCid = req.query.customer_cid || req.body?.customer_cid || 'unknown';

  // Intercept the response so we can write the audit log after Python responds.
  // We wrap res.json to capture the response body.
  const originalJson = res.json.bind(res);
  res.json = function interceptedJson(body) {
    // Write audit row — only after a successful response (2xx).
    if (res.statusCode >= 200 && res.statusCode < 300 && body && typeof body === 'object') {
      auditLog(
        userId,
        customerCid,
        body.match ?? null,
        body.distance ?? null,
        tenant,
      );
    }
    return originalJson(body);
  };

  streamProxy(req, res, '/api/v1/face-match', FACE_MATCH_TIMEOUT);
});

// ---------------------------------------------------------------------------
// GET /spa/api/face-match/:match_id
//
// Retrieve a stored match record. Auditor-only.
// RBAC: kyc:read
// Python: GET /api/v1/face-match/{match_id}
// ---------------------------------------------------------------------------

router.get('/face-match/:match_id', requirePermJson('kyc:read'), async (req, res) => {
  const { match_id } = req.params;

  const id = parseInt(match_id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'validation_failed', details: { match_id: 'must be a positive integer' } });
  }

  try {
    const data = await jsonProxy(`/api/v1/face-match/${id}`);
    res.json(data);
  } catch (err) {
    return handleUpstreamError(err, res);
  }
});

module.exports = router;

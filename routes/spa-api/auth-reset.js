'use strict';

/**
 * Forgot-password / reset-password endpoints (Plan 0 / Task 9a-9c).
 *
 * Mounted at /spa/api/auth (BEFORE requireAuthJson gate in spa-api.js)
 * so unauthenticated browsers can reach all three routes.
 *
 * Endpoints:
 *   POST /spa/api/auth/forgot-password
 *     Body: { username: string }
 *     Always returns 200 { ok: true } to prevent user-enumeration.
 *     Writes reset_token + reset_token_expires_at on the matched user row.
 *     Calls sendResetEmail (fire-and-forget in dev = console.log).
 *
 *   GET  /spa/api/auth/reset-password/:token/validate
 *     Returns 200 { ok: true } when token is valid and unexpired.
 *     Returns 404 or 410 otherwise (so the SPA can show the right error).
 *
 *   POST /spa/api/auth/reset-password
 *     Body: { token: string, password: string (min 8 chars) }
 *     bcrypt-hashes the new password at cost 12, nullifies the token columns.
 *
 *   GET  /spa/api/auth/_test_last_reset_token?username=<u>  (non-production only)
 *     Returns the current reset_token for a username — used by E2E tests to
 *     avoid standing up a real SMTP server. Guarded by NODE_ENV !== 'production'.
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { sendResetEmail } = require('../../services/email');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');

const router = express.Router();

/** Token TTL: 30 minutes */
const RESET_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Body validators (plain JS — no zod in Node tier per existing pattern)
// ---------------------------------------------------------------------------

function validateForgot(body) {
  if (!body || typeof body !== 'object') return null;
  const u = body.username;
  if (typeof u !== 'string' || u.length < 1 || u.length > 128) return null;
  return { username: u };
}

function validateReset(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.token !== 'string' || body.token.length < 32) return null;
  if (typeof body.password !== 'string' || body.password.length < 8) return null;
  return { token: body.token, password: body.password };
}

// ---------------------------------------------------------------------------
// POST /forgot-password
// ---------------------------------------------------------------------------
router.post('/forgot-password', (req, res) => {
  const v = validateForgot(req.body);
  if (!v) return res.status(400).json({ error: 'invalid_body' });

  const u = db.prepare(
    'SELECT id, email, username, tenant_id FROM users WHERE username = ?'
  ).get(v.username);

  // Always 200 to avoid user enumeration.
  if (!u) return res.json({ ok: true });

  const token   = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + RESET_TTL_MS).toISOString();

  db.prepare(
    'UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?'
  ).run(token, expires, u.id);

  if (u.email) {
    sendResetEmail(u.email, token).catch((e) =>
      console.error('[reset-email]', e.message)
    );
  }

  writeAuditRow({
    userId:         u.id,
    action:         'auth.reset_request',
    entityType:     'user',
    entityId:       String(u.id),
    detail:         { username: u.username },
    tenantId:       u.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /reset-password/:token/validate
// ---------------------------------------------------------------------------
router.get('/reset-password/:token/validate', (req, res) => {
  const u = db.prepare(
    'SELECT id, reset_token_expires_at FROM users WHERE reset_token = ?'
  ).get(req.params.token);

  if (!u) return res.status(404).json({ ok: false, error: 'invalid_token' });

  if (new Date(u.reset_token_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ ok: false, error: 'expired_token' });
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /reset-password
// ---------------------------------------------------------------------------
router.post('/reset-password', async (req, res) => {
  const v = validateReset(req.body);
  if (!v) return res.status(400).json({ error: 'invalid_body' });

  const u = db.prepare(
    'SELECT id, tenant_id, reset_token_expires_at FROM users WHERE reset_token = ?'
  ).get(v.token);

  if (!u) return res.status(404).json({ error: 'invalid_token' });

  if (new Date(u.reset_token_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'expired_token' });
  }

  const hash = await bcrypt.hash(v.password, 12);

  db.prepare(`
    UPDATE users
       SET password = ?, reset_token = NULL, reset_token_expires_at = NULL
     WHERE id = ?
  `).run(hash, u.id);

  writeAuditRow({
    userId:         u.id,
    action:         'auth.reset_complete',
    entityType:     'user',
    entityId:       String(u.id),
    tenantId:       u.tenant_id,
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// TEST-ONLY helper — guarded by NODE_ENV !== 'production'
// GET /spa/api/auth/_test_last_reset_token?username=<u>
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
  router.get('/_test_last_reset_token', (req, res) => {
    const u = db.prepare(
      'SELECT reset_token FROM users WHERE username = ?'
    ).get(req.query.username);
    res.json({ token: u?.reset_token || null });
  });
}

module.exports = router;

'use strict';
/**
 * User administration — Doc Admin only.
 *
 * Existing endpoints (v1 — unchanged behavior):
 *   GET    /users          — list users for tenant
 *   PATCH  /users/:id      — update role/branch/status/full_name/email
 *                            SoD enforcement now applied on role changes.
 *
 * Users v2 (migration 0031):
 *   POST   /admin/users/invite            — create invite record + send magic-link email
 *   GET    /admin/users/:id/factors       — list MFA factors for a user
 *   DELETE /admin/users/:id/factors/:fid  — disable/delete a factor
 *
 * NOTE: POST /users (plaintext password creation) is intentionally removed.
 *       All new user creation goes through the invite flow.
 *       Existing users created before this migration are unaffected.
 */

const express = require('express');
const crypto  = require('crypto');
const db      = require('../../db');
const { requirePermJson, requireNamespacePermJson, tenantScope, pyCall } = require('./_shared');
const { getConfig, setConfig } = require('../../db/tenant-config');
const { sendInvite } = require('../../services/invite-mailer');

const router = express.Router();

const ROLES    = new Set(['Doc Admin', 'Maker', 'Checker', 'Viewer']);
const STATUSES = new Set(['Active', 'Locked', 'Disabled']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function publicRow(u) {
  if (!u) return null;
  return {
    id:             u.id,
    username:       u.username,
    full_name:      u.full_name,
    email:          u.email,
    role:           u.role,
    branch:         u.branch,
    status:         u.status,
    mfa_enabled:    u.mfa_enabled ? 1 : 0,
    mfa_phone:      u.mfa_phone ?? null,
    tenant_id:      u.tenant_id || 'nbe',
    created_at:     u.created_at,
    invite_pending: u.password === null || u.password === undefined,
  };
}

function writeAudit({ userId, action, entityId, details, tenantId }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
     VALUES (?, ?, 'user', ?, ?, ?)`
  ).run(userId, action, entityId ?? null, details ? JSON.stringify(details) : null, tenantId ?? 'nbe');
}

/**
 * Resolve SoD forbidden pairs from tenant_config.
 * Default: [["Maker","Checker"]]
 */
function getSodPairs(tenantId) {
  const raw = getConfig(tenantId, 'rbac', 'sod_forbidden_pairs', null);
  if (!raw) return [['Maker', 'Checker']];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  return [['Maker', 'Checker']];
}

function sodViolation(tenantId, currentRole, newRole) {
  const pairs = getSodPairs(tenantId);
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [a, b] = pair;
    if ((currentRole === a && newRole === b) || (currentRole === b && newRole === a)) {
      return pair;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /users
// ---------------------------------------------------------------------------

router.get('/users', requirePermJson('admin'), (req, res) => {
  const tenant = tenantScope(req);
  const rows = db.prepare(
    `SELECT id, username, full_name, email, role, branch, status,
            mfa_enabled, mfa_phone, password, tenant_id, created_at
     FROM users WHERE tenant_id = ? ORDER BY username`,
  ).all(tenant);
  res.json(rows.map(publicRow));
});

// ---------------------------------------------------------------------------
// PATCH /users/:id — SoD enforced on role changes
// ---------------------------------------------------------------------------

router.patch('/users/:id', requirePermJson('admin'), (req, res) => {
  const id       = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const tenant = tenantScope(req);
  const body   = req.body ?? {};
  const sets   = [];
  const values = [];

  if (typeof body.full_name === 'string') { sets.push('full_name = ?'); values.push(body.full_name); }
  if (typeof body.email === 'string')     { sets.push('email = ?');     values.push(body.email); }
  if (typeof body.mfa_phone === 'string') { sets.push('mfa_phone = ?'); values.push(body.mfa_phone || null); }
  if ('branch' in body) { sets.push('branch = ?'); values.push(body.branch ?? null); }

  if ('role' in body) {
    if (!ROLES.has(body.role)) return res.status(400).json({ error: 'invalid_role' });
    const pair = sodViolation(tenant, existing.role, body.role);
    if (pair) {
      try {
        setConfig(tenant, '_user_meta', 'last_sod_violation_at', new Date().toISOString(), {
          actorUserId: req.session.user.id,
          reason: `SoD violation attempt: ${existing.role} + ${body.role} on user ${id}`,
        });
      } catch (_) {}
      return res.status(400).json({
        error:   'sod_violation',
        pair,
        message: `A user cannot hold both ${pair[0]} and ${pair[1]} roles`,
      });
    }
    sets.push('role = ?'); values.push(body.role);
  }

  if ('status' in body) {
    if (!STATUSES.has(body.status)) return res.status(400).json({ error: 'invalid_status' });
    sets.push('status = ?'); values.push(body.status);
  }

  if ('mfa_enabled' in body) {
    sets.push('mfa_enabled = ?'); values.push(body.mfa_enabled ? 1 : 0);
    if (!body.mfa_enabled) { sets.push('mfa_secret = ?'); values.push(null); }
  }

  if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });
  values.push(id);

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  writeAudit({
    userId:   req.session.user.id,
    action:   'USER_UPDATE',
    entityId: id,
    details:  Object.keys(body),
    tenantId: tenant,
  });

  if ('role' in body) {
    try {
      setConfig(tenant, '_user_meta', 'last_grant_at', new Date().toISOString(), {
        actorUserId: req.session.user.id,
        reason: `Role changed for user ${id}: ${existing.role} -> ${body.role}`,
      });
    } catch (_) {}
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json(publicRow(row));
});

// ---------------------------------------------------------------------------
// POST /admin/users/invite
// ---------------------------------------------------------------------------

router.post('/admin/users/invite', requireNamespacePermJson('users'), async (req, res) => {
  const { email, role, branch, reason } = req.body ?? {};
  const tenant  = tenantScope(req);
  const actorId = req.session.user.id;

  if (typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  if (!ROLES.has(role)) return res.status(400).json({ error: 'invalid_role' });
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    return res.status(400).json({ error: 'reason_required', detail: 'Minimum 10 characters' });
  }

  const existingInvite = db.prepare(
    `SELECT id FROM user_invites
     WHERE email = ? AND tenant_id = ? AND used_at IS NULL AND expires_at > datetime('now')`
  ).get(email, tenant);
  if (existingInvite) return res.status(409).json({ error: 'invite_pending' });

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ? AND tenant_id = ?').get(email, tenant);
  if (existingUser) return res.status(409).json({ error: 'email_taken' });

  const rawToken  = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const ttlHours  = getConfig(tenant, 'auth', 'magic_link_ttl_hours', 168);
  const expiresAt = new Date(Date.now() + Number(ttlHours) * 3600 * 1000).toISOString();

  const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 50) || 'user';
  let finalUsername = baseUsername;
  let suffix = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ? AND tenant_id = ?').get(finalUsername, tenant)) {
    finalUsername = `${baseUsername}${suffix}`;
    suffix++;
  }

  const ins = db.prepare(
    `INSERT INTO users (username, password, email, role, branch, status, tenant_id)
     VALUES (?, NULL, ?, ?, ?, 'Active', ?)`
  ).run(finalUsername, email, role, branch ?? null, tenant);
  const newUserId = ins.lastInsertRowid;

  db.prepare(
    `INSERT INTO user_invites (email, token_hash, role, branch, expires_at, created_by, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(email, tokenHash, role, branch ?? null, expiresAt, actorId, tenant);

  writeAudit({
    userId:   actorId,
    action:   'USER_INVITE',
    entityId: newUserId,
    details:  { email, role, branch, expires_at: expiresAt },
    tenantId: tenant,
  });

  try {
    setConfig(tenant, '_user_meta', 'last_invite_at', new Date().toISOString(), {
      actorUserId: actorId,
      reason: `Invite sent to ${email} for role ${role}: ${reason.trim()}`,
    });
  } catch (_) {}

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const actor   = db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(actorId);
  sendInvite({
    tenantId:    tenant,
    toEmail:     email,
    rawToken,
    role,
    inviterName: actor ? (actor.full_name || actor.username) : 'Admin',
    baseUrl,
  }).catch((err) => console.error('[users.invite] mailer error:', err.message));

  const resp = {
    ok:         true,
    user_id:    Number(newUserId),
    username:   finalUsername,
    email,
    role,
    branch:     branch ?? null,
    expires_at: expiresAt,
  };
  if (process.env.NODE_ENV !== 'production') {
    resp.dev_link = `${baseUrl}/set-password?token=${encodeURIComponent(rawToken)}`;
  }
  res.status(201).json(resp);
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id/factors
// ---------------------------------------------------------------------------

router.get('/admin/users/:id/factors', requirePermJson('admin'), async (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const row = db.prepare(
    'SELECT id, mfa_enabled, mfa_phone, username FROM users WHERE id = ?'
  ).get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const factors = [];

  factors.push({
    id:      `totp:${id}`,
    kind:    'totp',
    enabled: row.mfa_enabled === 1,
    label:   'TOTP Authenticator App',
  });

  if (row.mfa_phone) {
    factors.push({
      id:      `sms:${id}`,
      kind:    'sms',
      enabled: true,
      label:   `SMS to ${row.mfa_phone.slice(0, 4)}****`,
    });
  }

  try {
    const creds = await pyCall(
      `/api/v1/users-admin/${encodeURIComponent(row.username)}/webauthn-credentials`,
      { timeout: 10000 }
    );
    if (Array.isArray(creds)) {
      for (const c of creds) {
        factors.push({
          id:           `webauthn:${c.id}`,
          kind:         'webauthn',
          enabled:      true,
          label:        c.friendly_name ?? `Security key (${String(c.id).slice(0, 8)})`,
          last_used_at: c.last_used_at ?? null,
        });
      }
    }
  } catch (_) {
    // Python unavailable — TOTP/SMS factors still returned.
  }

  res.json({ user_id: id, factors });
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id/factors/:fid
// ---------------------------------------------------------------------------

router.delete('/admin/users/:id/factors/:fid', requirePermJson('admin'), async (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const fid = req.params.fid;
  const tenant = tenantScope(req);

  const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const colonIdx = fid.indexOf(':');
  const kind   = colonIdx >= 0 ? fid.slice(0, colonIdx)  : fid;
  const credId = colonIdx >= 0 ? fid.slice(colonIdx + 1) : '';

  if (kind === 'totp') {
    db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(id);
    writeAudit({ userId: req.session.user.id, action: 'MFA_DISABLE_TOTP', entityId: id, tenantId: tenant });
    return res.json({ ok: true, factor_id: fid });
  }

  if (kind === 'sms') {
    db.prepare('UPDATE users SET mfa_phone = NULL WHERE id = ?').run(id);
    writeAudit({ userId: req.session.user.id, action: 'MFA_DISABLE_SMS', entityId: id, tenantId: tenant });
    return res.json({ ok: true, factor_id: fid });
  }

  if (kind === 'webauthn') {
    try {
      await pyCall(
        `/api/v1/users-admin/${encodeURIComponent(row.username)}/webauthn-credentials/${encodeURIComponent(credId)}`,
        { method: 'DELETE', timeout: 10000 }
      );
      writeAudit({ userId: req.session.user.id, action: 'MFA_REVOKE_WEBAUTHN',
                   entityId: id, details: { credential_id: credId }, tenantId: tenant });
      return res.json({ ok: true, factor_id: fid });
    } catch (err) {
      return res.status(502).json({ error: 'python_error', detail: err.message });
    }
  }

  return res.status(400).json({ error: 'unknown_factor_kind', kind });
});

module.exports = router;

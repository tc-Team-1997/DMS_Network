/**
 * User administration — Doc Admin only.
 * Supports list + create + patch (role, branch, status, password reset,
 * lock/unlock). Passwords hashed with bcryptjs.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { requirePermJson, tenantScope } = require('./_shared');

const router = express.Router();

const ROLES = new Set(['Doc Admin', 'Maker', 'Checker', 'Viewer']);
const STATUSES = new Set(['Active', 'Locked', 'Disabled']);

function publicRow(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    email: u.email,
    role: u.role,
    branch: u.branch,
    status: u.status,
    mfa_enabled: u.mfa_enabled ? 1 : 0,
    tenant_id: u.tenant_id || 'nbe',
    created_at: u.created_at,
  };
}

router.get('/users', requirePermJson('admin'), (req, res) => {
  const tenant = tenantScope(req);
  const rows = db.prepare(
    `SELECT id, username, full_name, email, role, branch, status, mfa_enabled, tenant_id, created_at
     FROM users WHERE tenant_id = ? ORDER BY username`,
  ).all(tenant);
  res.json(rows.map(publicRow));
});

router.post('/users', requirePermJson('admin'), (req, res) => {
  const { username, password, full_name, email, role, branch } = req.body ?? {};
  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username_required' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'password_too_short' });
  }
  if (!ROLES.has(role)) return res.status(400).json({ error: 'invalid_role' });
  const hash = bcrypt.hashSync(password, 10);
  const tenant = tenantScope(req);
  try {
    const info = db.prepare(
      `INSERT INTO users (username, password, full_name, email, role, branch, status, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, 'Active', ?)`,
    ).run(
      username.trim(), hash, full_name ?? null, email ?? null, role,
      branch ?? null, tenant,
    );
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, tenant_id) VALUES (?, ?, ?, ?, ?)')
      .run(req.session.user.id, 'USER_CREATE', 'user', info.lastInsertRowid, tenant);
    res.status(201).json(publicRow(row));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'username_taken' });
    res.status(500).json({ error: 'insert_failed', detail: err.message });
  }
});

router.patch('/users/:id', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body ?? {};
  const sets = [];
  const values = [];

  if (typeof body.full_name === 'string') { sets.push('full_name = ?'); values.push(body.full_name); }
  if (typeof body.email === 'string') { sets.push('email = ?'); values.push(body.email); }
  if ('branch' in body) { sets.push('branch = ?'); values.push(body.branch ?? null); }
  if ('role' in body) {
    if (!ROLES.has(body.role)) return res.status(400).json({ error: 'invalid_role' });
    sets.push('role = ?'); values.push(body.role);
  }
  if ('status' in body) {
    if (!STATUSES.has(body.status)) return res.status(400).json({ error: 'invalid_status' });
    sets.push('status = ?'); values.push(body.status);
  }
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 6) return res.status(400).json({ error: 'password_too_short' });
    sets.push('password = ?'); values.push(bcrypt.hashSync(body.password, 10));
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });
  values.push(id);

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      req.session.user.id, 'USER_UPDATE', 'user', id,
      JSON.stringify(Object.keys(body)),
      tenantScope(req),
    );
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json(publicRow(row));
});

module.exports = router;

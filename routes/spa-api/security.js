/**
 * Security & RBAC read-only endpoints. Surfaces the role/permission
 * matrix (from services/rbac.js) and the recent login audit so admins
 * can see who has what access and who's been active.
 */
const express = require('express');
const db = require('../../db');
const rbac = require('../../services/rbac');
const { requirePermJson } = require('./_shared');

const router = express.Router();

router.get('/security/rbac', requirePermJson('admin'), (_req, res) => {
  // Normalise PERMS from {role: [perm, ...]} into a matrix the UI can render.
  const roles = Object.keys(rbac.PERMS);
  const permSet = new Set();
  for (const role of roles) for (const p of rbac.PERMS[role]) permSet.add(p);
  const perms = [...permSet].sort();
  const matrix = roles.map((role) => ({
    role,
    perms: Object.fromEntries(perms.map((p) => [p, rbac.PERMS[role].includes(p)])),
  }));

  const byRole = db.prepare(
    `SELECT role, COUNT(*) c FROM users GROUP BY role`,
  ).all();

  res.json({ roles, permissions: perms, matrix, userCounts: byRole });
});

router.get('/security/sessions', requirePermJson('admin'), (_req, res) => {
  // "Sessions" = last N login events from audit_log joined to users.
  const rows = db.prepare(`
    SELECT a.id, a.user_id, u.username, u.full_name, u.role, u.branch,
           a.action, a.created_at
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.action IN ('SPA_LOGIN', 'LOGIN', 'LOGOUT')
    ORDER BY a.created_at DESC
    LIMIT 50
  `).all();
  res.json(rows);
});

module.exports = router;

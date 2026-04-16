const router = require('express').Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const rbac = require('../services/rbac');

router.use(rbac.require('admin'));

router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, full_name, role, branch, mfa_enabled, status FROM users').all();
  const audit = db.prepare('SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.id DESC LIMIT 20').all();
  res.render('admin', { active: 'admin', users, audit });
});

router.get('/security', (req, res) => {
  const users = db.prepare('SELECT id, username, full_name, role, branch, mfa_enabled, status FROM users').all();
  res.render('security', { active: 'security', users });
});

router.post('/users', (req, res) => {
  const { username, password, full_name, role, branch } = req.body;
  const hash = bcrypt.hashSync(password || 'changeme123', 10);
  db.prepare('INSERT INTO users (username, password, full_name, role, branch) VALUES (?, ?, ?, ?, ?)')
    .run(username, hash, full_name, role, branch);
  res.redirect('/admin/security');
});

router.post('/users/:id/toggle', (req, res) => {
  const u = db.prepare('SELECT status FROM users WHERE id=?').get(req.params.id);
  const next = u.status === 'Active' ? 'Locked' : 'Active';
  db.prepare('UPDATE users SET status=? WHERE id=?').run(next, req.params.id);
  res.redirect('/admin/security');
});

router.get('/integration', (req, res) => res.render('integration', { active: 'integration' }));

module.exports = router;

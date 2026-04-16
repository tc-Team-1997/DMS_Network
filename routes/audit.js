const router = require('express').Router();
const db = require('../db');
const rbac = require('../services/rbac');

router.use(rbac.require('admin'));

router.get('/', (req, res) => {
  const { user, action, entity, from, to } = req.query;
  let sql = 'SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON a.user_id=u.id WHERE 1=1';
  const p = [];
  if (user) { sql += ' AND u.username LIKE ?'; p.push(`%${user}%`); }
  if (action) { sql += ' AND a.action LIKE ?'; p.push(`%${action}%`); }
  if (entity) { sql += ' AND a.entity = ?'; p.push(entity); }
  if (from) { sql += ' AND a.created_at >= ?'; p.push(from); }
  if (to) { sql += ' AND a.created_at <= ?'; p.push(to + ' 23:59:59'); }
  sql += ' ORDER BY a.id DESC LIMIT 500';
  const rows = db.prepare(sql).all(...p);
  const actions = db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map(r => r.action);
  const entities = db.prepare('SELECT DISTINCT entity FROM audit_log ORDER BY entity').all().map(r => r.entity);
  res.render('audit', { active: 'admin', rows, actions, entities, query: req.query });
});

module.exports = router;

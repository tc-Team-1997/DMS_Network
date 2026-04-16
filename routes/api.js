const router = require('express').Router();
const db = require('../db');

function apiAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing x-api-key' });
  const user = db.prepare('SELECT * FROM users WHERE api_key = ? AND status = ?').get(key, 'Active');
  if (!user) return res.status(401).json({ error: 'Invalid api key' });
  req.apiUser = user;
  next();
}

router.use(apiAuth);

router.get('/documents', (req, res) => {
  const { limit = 50, status, type } = req.query;
  let sql = 'SELECT id, original_name, doc_type, customer_cid, customer_name, expiry_date, status, uploaded_at FROM documents WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (type) { sql += ' AND doc_type = ?'; params.push(type); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Math.min(parseInt(limit), 500));
  res.json(db.prepare(sql).all(...params));
});

router.get('/documents/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

router.get('/workflows', (req, res) => {
  res.json(db.prepare('SELECT * FROM workflows ORDER BY id DESC').all());
});

router.post('/workflows/:id/action', (req, res) => {
  const { action } = req.body;
  const stageMap = { approve: 'Approved', reject: 'Rejected - Rework', escalate: 'Manager Sign-off' };
  if (!stageMap[action]) return res.status(400).json({ error: 'Invalid action' });
  db.prepare("UPDATE workflows SET stage=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(stageMap[action], req.params.id);
  res.json({ ok: true, stage: stageMap[action] });
});

router.get('/stats', (req, res) => {
  res.json({
    total: db.prepare('SELECT COUNT(*) c FROM documents').get().c,
    expired: db.prepare("SELECT COUNT(*) c FROM documents WHERE status='Expired'").get().c,
    expiring: db.prepare("SELECT COUNT(*) c FROM documents WHERE status='Expiring'").get().c,
    pending_workflows: db.prepare("SELECT COUNT(*) c FROM workflows WHERE stage NOT IN ('Approved')").get().c
  });
});

module.exports = router;

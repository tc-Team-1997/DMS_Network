const router = require('express').Router();
const db = require('../db');

router.use((req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

router.get('/:docId', (req, res) => {
  const rows = db.prepare('SELECT a.*, u.username FROM annotations a LEFT JOIN users u ON a.user_id=u.id WHERE doc_id=? ORDER BY id').all(req.params.docId);
  res.json(rows);
});

router.post('/:docId', (req, res) => {
  const { page, kind, x, y, w, h, text, color } = req.body;
  const info = db.prepare('INSERT INTO annotations (doc_id, user_id, page, kind, x, y, w, h, text, color) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(req.params.docId, req.session.user.id, page||1, kind||'note', x||0, y||0, w||0, h||0, text||'', color||'#c9a84c');
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.delete('/:docId/:id', (req, res) => {
  db.prepare('DELETE FROM annotations WHERE id=? AND doc_id=?').run(req.params.id, req.params.docId);
  res.json({ ok: true });
});

module.exports = router;

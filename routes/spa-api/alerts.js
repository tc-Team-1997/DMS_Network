const express = require('express');
const db = require('../../db');

const router = express.Router();

router.get('/alerts', (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 500);
  res.json(db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?').all(limit));
});

router.post('/alerts/:id/read', (req, res) => {
  db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

module.exports = router;

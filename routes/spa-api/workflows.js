const express = require('express');
const db = require('../../db');
const { requirePermJson } = require('./_shared');

const router = express.Router();

router.get('/workflows', (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? 100), 10) || 100, 500);
  res.json(db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC LIMIT ?').all(limit));
});

router.post('/workflows/:id/actions', requirePermJson('workflow'), (req, res) => {
  const { action } = req.body ?? {};
  const stageMap = { approve: 'Approved', reject: 'Rejected - Rework', escalate: 'Manager Sign-off' };
  const stage = stageMap[action];
  if (!stage) return res.status(400).json({ error: 'invalid_action' });
  db.prepare('UPDATE workflows SET stage=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(stage, parseInt(req.params.id, 10));
  res.json({ ok: true, stage });
});

module.exports = router;

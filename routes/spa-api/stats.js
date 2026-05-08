const express = require('express');
const db = require('../../db');
const { branchScope } = require('./_shared');

const router = express.Router();

router.get('/stats', (req, res) => {
  const scope = branchScope(req.session.user);
  const branchClause = scope ? ' AND branch = ?' : '';
  const p = scope ? [scope] : [];
  const count = (predicate) =>
    db.prepare(`SELECT COUNT(*) c FROM documents WHERE ${predicate}${branchClause}`).get(...p).c;

  res.json({
    total:             count('1 = 1'),
    valid:             count("status = 'Valid'"),
    expired:           count("status = 'Expired'"),
    expiring:          count("status = 'Expiring'"),
    pending_workflows: db.prepare("SELECT COUNT(*) c FROM workflows WHERE stage <> 'Approved'").get().c,
    unread_alerts:     db.prepare('SELECT COUNT(*) c FROM alerts WHERE is_read = 0').get().c,
  });
});

router.get('/stats/expiry', (_req, res) => {
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN expiry_date IS NULL THEN 'No expiry'
        WHEN expiry_date < date('now') THEN 'Expired'
        WHEN expiry_date < date('now','+30 days') THEN '< 30 days'
        WHEN expiry_date < date('now','+90 days') THEN '30–90 days'
        WHEN expiry_date < date('now','+365 days') THEN '3–12 months'
        ELSE '> 1 year'
      END AS bucket,
      COUNT(*) c
    FROM documents GROUP BY bucket
  `).all();
  const order = ['Expired', '< 30 days', '30–90 days', '3–12 months', '> 1 year', 'No expiry'];
  const map = Object.fromEntries(rows.map((r) => [r.bucket, r.c]));
  res.json({
    labels: order,
    counts: order.map((k) => map[k] ?? 0),
  });
});

router.get('/stats/doc-types', (_req, res) => {
  const rows = db.prepare(`
    SELECT COALESCE(doc_type, 'Uncategorized') doc_type, COUNT(*) count
    FROM documents GROUP BY doc_type ORDER BY count DESC LIMIT 8
  `).all();
  res.json(rows);
});

module.exports = router;

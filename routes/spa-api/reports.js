/**
 * Reports & BI endpoints — aggregates on top of the existing document,
 * workflow, alert tables. Reuses branch scoping from _shared so Makers /
 * Viewers only see their own branch.
 */
const express = require('express');
const db = require('../../db');
const { branchScope } = require('./_shared');

const router = express.Router();

router.get('/reports/summary', (req, res) => {
  const scope = branchScope(req.session.user);
  const branchClause = scope ? ' AND branch = ?' : '';
  const p = scope ? [scope] : [];

  const count = (extra) =>
    db.prepare(
      `SELECT COUNT(*) c FROM documents WHERE 1=1 ${extra}${branchClause}`,
    ).get(...p).c;

  const monthly = db.prepare(
    `SELECT
       strftime('%Y-%m', uploaded_at) AS month,
       COUNT(*) AS count
     FROM documents
     WHERE uploaded_at >= date('now','-6 months') ${branchClause}
     GROUP BY month
     ORDER BY month`,
  ).all(...p);

  const byBranch = scope
    ? db.prepare(
        `SELECT branch, COUNT(*) c FROM documents WHERE branch = ? GROUP BY branch`,
      ).all(scope)
    : db.prepare(
        `SELECT COALESCE(branch, 'Unassigned') AS branch, COUNT(*) c
         FROM documents GROUP BY branch ORDER BY c DESC LIMIT 12`,
      ).all();

  const byType = db.prepare(
    `SELECT COALESCE(doc_type, 'Uncategorized') AS doc_type, COUNT(*) c
     FROM documents WHERE 1=1 ${branchClause}
     GROUP BY doc_type ORDER BY c DESC LIMIT 12`,
  ).all(...p);

  const expiry = {
    d30: count("AND expiry_date IS NOT NULL AND expiry_date BETWEEN date('now') AND date('now','+30 days')"),
    d60: count("AND expiry_date IS NOT NULL AND expiry_date BETWEEN date('now','+31 days') AND date('now','+60 days')"),
    d90: count("AND expiry_date IS NOT NULL AND expiry_date BETWEEN date('now','+61 days') AND date('now','+90 days')"),
  };

  res.json({
    totals: {
      all:      count('AND 1=1'),
      valid:    count("AND status = 'Valid'"),
      expiring: count("AND status = 'Expiring'"),
      expired:  count("AND status = 'Expired'"),
    },
    monthly: monthly.map((r) => ({ month: r.month, count: r.count })),
    by_branch: byBranch.map((r) => ({ branch: r.branch, count: r.c })),
    by_type:   byType.map((r) => ({ doc_type: r.doc_type, count: r.c })),
    expiry,
    workflows: {
      pending:  db.prepare("SELECT COUNT(*) c FROM workflows WHERE stage NOT IN ('Approved') AND stage NOT LIKE 'Rejected%'").get().c,
      approved: db.prepare("SELECT COUNT(*) c FROM workflows WHERE stage = 'Approved'").get().c,
      rejected: db.prepare("SELECT COUNT(*) c FROM workflows WHERE stage LIKE 'Rejected%'").get().c,
    },
  });
});

// CSV export — the full repository in scope, flattened to one row per doc.
// `Content-Disposition: attachment` so the browser downloads it.
router.get('/reports/export.csv', (req, res) => {
  const scope = branchScope(req.session.user);
  const branchClause = scope ? 'WHERE branch = ?' : '';
  const rows = db.prepare(
    `SELECT id, original_name, doc_type, customer_name, customer_cid, doc_number,
            branch, status, issue_date, expiry_date, issuing_authority,
            ocr_confidence, uploaded_at
     FROM documents ${branchClause}
     ORDER BY uploaded_at DESC
     LIMIT 10000`,
  ).all(...(scope ? [scope] : []));

  const header = [
    'id', 'original_name', 'doc_type', 'customer_name', 'customer_cid', 'doc_number',
    'branch', 'status', 'issue_date', 'expiry_date', 'issuing_authority',
    'ocr_confidence', 'uploaded_at',
  ];
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map((h) => escape(r[h])).join(','));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="documents-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
});

module.exports = router;

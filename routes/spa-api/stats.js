'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { branchScope, pyCall } = require('./_shared');

const router = express.Router();

// Derive the uploads directory the same way documents.js does.
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

/**
 * GET /spa/api/stats
 *
 * Primary dashboard stats endpoint. Returns the canonical shape:
 *   total_documents, pending_workflows, compliance_score,
 *   active_alerts, documents_expiring_30d, storage_used_gb
 *
 * Additionally returns legacy fields (total, valid, expired, expiring,
 * unread_alerts) so existing SPA callers keep working unchanged.
 *
 * compliance_score proxies to Python /compliance/scorecard; on failure it
 * falls back to a local heuristic derived from expiry + workflow data.
 */
router.get('/stats', async (req, res) => {
  try {
    const scope = branchScope(req.session.user);
    const branchClause = scope ? ' AND branch = ?' : '';
    const p = scope ? [scope] : [];

    const count = (predicate) =>
      db.prepare(`SELECT COUNT(*) c FROM documents WHERE ${predicate}${branchClause}`).get(...p).c;

    const totalDocs    = count('1 = 1');
    const validDocs    = count("status = 'Valid'");
    const expiredDocs  = count("status = 'Expired'");
    const expiringDocs = count("status = 'Expiring'");

    const expiring30 = db.prepare(
      `SELECT COUNT(*) c FROM documents
       WHERE expiry_date IS NOT NULL
         AND expiry_date BETWEEN date('now') AND date('now','+30 days')${branchClause}`,
    ).get(...p).c;

    const pendingWorkflows = db.prepare(
      "SELECT COUNT(*) c FROM workflows WHERE stage NOT IN ('Approved') AND stage NOT LIKE 'Rejected%'",
    ).get().c;

    const unreadAlerts = db.prepare('SELECT COUNT(*) c FROM alerts WHERE is_read = 0').get().c;
    const activeAlerts = unreadAlerts; // "active" = unread in this schema

    // ── Storage estimate ─────────────────────────────────────────────────────
    // Sum file sizes from the DB (always present) for an exact byte count,
    // then fall back to scanning the uploads dir if the DB value is 0.
    let storageBytes = 0;
    try {
      const sizeRow = db.prepare('SELECT SUM(size) AS s FROM documents').get();
      storageBytes = sizeRow && sizeRow.s ? sizeRow.s : 0;
    } catch { /* ignore */ }

    if (storageBytes === 0 && fs.existsSync(uploadsDir)) {
      try {
        for (const f of fs.readdirSync(uploadsDir)) {
          try { storageBytes += fs.statSync(path.join(uploadsDir, f)).size; } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }

    // Express in GB, rounded to 2 decimal places. Return at least 0.01 when
    // any files exist so the UI doesn't show "0 GB stored" after first upload.
    const storageGb = storageBytes > 0
      ? Math.max(0.01, Math.round((storageBytes / (1024 ** 3)) * 100) / 100)
      : 0;

    // ── Compliance score — try Python, fall back to local heuristic ──────────
    let complianceScore = null;
    try {
      const pyData = await pyCall('/api/v1/compliance/scorecard', { timeout: 8000 });
      // Python service may return { overall_score: 91 } or { score: 91 } etc.
      const raw = pyData?.overall_score ?? pyData?.score ?? pyData?.compliance_score ?? null;
      if (typeof raw === 'number') complianceScore = Math.round(raw);
    } catch { /* Python not available — fall back below */ }

    if (complianceScore === null) {
      // Local heuristic: 100 minus deductions for expiry and workflow SLA.
      // Each expired doc deducts up to 20 total; each late workflow up to 10.
      const expiredPct  = totalDocs > 0 ? (expiredDocs / totalDocs) : 0;
      const expiredDeduct = Math.round(expiredPct * 20);

      const lateWorkflows = db.prepare(`
        SELECT COUNT(*) c FROM workflows
        WHERE stage NOT LIKE 'Approved%' AND stage NOT LIKE 'Rejected%'
          AND julianday('now') - julianday(updated_at) > 3
      `).get().c;
      const wfDeduct = Math.min(10, lateWorkflows * 2);

      complianceScore = Math.max(0, Math.min(100, 100 - expiredDeduct - wfDeduct));
    }

    res.json({
      // ── Dashboard contract shape ─────────────────────────────────────────
      total_documents:       totalDocs,
      pending_workflows:     pendingWorkflows,
      compliance_score:      complianceScore,
      active_alerts:         activeAlerts,
      documents_expiring_30d: expiring30,
      storage_used_gb:       storageGb,
      // ── Legacy fields kept for backward compat ───────────────────────────
      total:             totalDocs,
      valid:             validDocs,
      expired:           expiredDocs,
      expiring:          expiringDocs,
      unread_alerts:     unreadAlerts,
    });
  } catch (err) {
    console.error('[stats] error:', err);
    res.status(500).json({ error: 'stats_failed', detail: err.message });
  }
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

/**
 * System Admin ops. Health probes, audit viewer, retention trigger,
 * cache bust, dedup settings, dead-letter queue. Doc Admin only.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { pyCall, requirePermJson, tenantScope } = require('./_shared');
const { uploadsDir } = require('./documents');
const dupSvc = require('../../services/duplicates');
const { getDeadLetterItems } = require('../../services/offline-queue');

const router = express.Router();

router.get('/admin/health', requirePermJson('admin'), async (_req, res) => {
  const started = process.uptime();
  let python = { ok: false, status: 0 };
  try {
    const data = await pyCall('/health');
    python = { ok: true, status: 200, data };
  } catch (err) {
    python = { ok: false, status: err.status || 0, error: err.message };
  }

  // DB + uploads directory size (best effort; missing uploads dir is fine).
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
  let uploadsSize = 0;
  try {
    for (const f of fs.readdirSync(uploadsDir)) {
      uploadsSize += fs.statSync(path.join(uploadsDir, f)).size;
    }
  } catch { /* ignore */ }

  const dbFile = path.join(__dirname, '..', '..', 'db', 'nbe-dms.db');
  const dbSize = fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0;

  const counts = {
    users:     db.prepare('SELECT COUNT(*) c FROM users').get().c,
    documents: db.prepare('SELECT COUNT(*) c FROM documents').get().c,
    workflows: db.prepare('SELECT COUNT(*) c FROM workflows').get().c,
    alerts:    db.prepare('SELECT COUNT(*) c FROM alerts').get().c,
  };

  res.json({
    node: {
      ok: true,
      uptime_seconds: Math.round(started),
      node_version: process.version,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    python,
    storage: {
      db_bytes: dbSize,
      uploads_bytes: uploadsSize,
    },
    counts,
  });
});

router.get('/admin/audit-log', requirePermJson('admin'), (req, res) => {
  const tenant = tenantScope(req);
  const limit = Math.min(parseInt(String(req.query.limit ?? 100), 10) || 100, 500);
  const rows = db.prepare(`
    SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at,
           u.username, u.role
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.tenant_id = ? OR a.tenant_id IS NULL
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(tenant, limit);
  res.json(rows);
});

/**
 * Bulk re-index: iterates every document in the tenant and re-runs DocBrain
 * analyse (OCR → classify → extract → embed). Use after changing the embed
 * model, tuning chunking, or when the vector store gets out of sync with
 * the document set.
 */
router.post('/admin/docbrain/reindex-all', requirePermJson('admin'), async (req, res) => {
  const tenant = tenantScope(req);
  const rows = db.prepare(
    'SELECT id, filename, mime_type FROM documents WHERE tenant_id = ? ORDER BY id',
  ).all(tenant);

  const summary = { total: rows.length, ok: 0, failed: 0, skipped: 0, errors: [] };

  for (const row of rows) {
    const fp = path.join(uploadsDir, row.filename);
    if (!fs.existsSync(fp)) {
      summary.skipped += 1;
      summary.errors.push({ id: row.id, reason: 'file_missing' });
      continue;
    }
    try {
      const buf = fs.readFileSync(fp);
      const data = await pyCall('/api/v1/docbrain/analyze', {
        method: 'POST',
        body: {
          document_id: row.id,
          bytes_b64: buf.toString('base64'),
          mime_type: row.mime_type || 'application/octet-stream',
        },
        timeout: 180_000,
      });
      // Mirror any high-confidence extractions back onto the doc row (same
      // rule as /docbrain/analyze in docbrain.js).
      if (data?.classification?.doc_class && data.classification.doc_class !== 'Unknown') {
        db.prepare('UPDATE documents SET doc_type = COALESCE(doc_type, ?) WHERE id = ?')
          .run(data.classification.doc_class, row.id);
      }
      summary.ok += 1;
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ id: row.id, reason: err.message?.slice(0, 120) ?? 'unknown' });
    }
  }

  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, details, tenant_id) VALUES (?, ?, ?, ?, ?)',
  ).run(
    req.session.user.id, 'DOCBRAIN_REINDEX_ALL', 'system',
    JSON.stringify(summary),
    tenant,
  );
  // Keep the error list short enough to fit in the UI.
  summary.errors = summary.errors.slice(0, 20);
  res.json(summary);
});

router.post('/admin/retention/trigger', requirePermJson('admin'), (req, res) => {
  // Stub — the real retention job lives in services/retention.js and runs
  // on cron. Doc Admin hits this button to log an attempt and echo back.
  const pols = db.prepare('SELECT * FROM retention_policies').all();
  db.prepare('INSERT INTO audit_log (user_id, action, entity, tenant_id) VALUES (?, ?, ?, ?)')
    .run(req.session.user.id, 'RETENTION_TRIGGER', 'system', tenantScope(req));
  res.json({ ok: true, policies: pols.length });
});

// ---------------------------------------------------------------------------
// Req 44-45 — Dedup settings admin
// ---------------------------------------------------------------------------

/**
 * GET /spa/api/admin/dedup-settings
 * Returns the current thresholds for the caller's tenant.
 */
router.get('/admin/dedup-settings', requirePermJson('admin'), (req, res) => {
  const tenant = tenantScope(req);
  const row = db.prepare(
    'SELECT tenant_id, fuzzy_threshold, phash_distance, updated_at, updated_by FROM dedup_settings WHERE tenant_id = ?'
  ).get(tenant);
  if (!row) {
    // Return defaults if row is missing (shouldn't happen post-seed, but be defensive).
    return res.json({
      tenant_id: tenant,
      fuzzy_threshold: dupSvc.DEFAULTS.fuzzy_threshold,
      phash_distance:  dupSvc.DEFAULTS.phash_distance,
      updated_at: null,
      updated_by: null,
    });
  }
  res.json(row);
});

/**
 * PUT /spa/api/admin/dedup-settings
 * Body: { fuzzy_threshold?: number, phash_distance?: number }
 * Upserts thresholds and writes an audit log entry.
 */
router.put('/admin/dedup-settings', requirePermJson('admin'), (req, res) => {
  const tenant  = tenantScope(req);
  const userId  = req.session.user.id;
  const { fuzzy_threshold, phash_distance } = req.body || {};

  // Validate
  if (fuzzy_threshold !== undefined) {
    const ft = Number(fuzzy_threshold);
    if (isNaN(ft) || ft < 0 || ft > 1) {
      return res.status(400).json({ error: 'fuzzy_threshold must be a number between 0 and 1' });
    }
  }
  if (phash_distance !== undefined) {
    const pd = Number(phash_distance);
    if (isNaN(pd) || pd < 0 || !Number.isInteger(pd)) {
      return res.status(400).json({ error: 'phash_distance must be a non-negative integer' });
    }
  }

  // Merge with existing values so a partial update doesn't zero the other field.
  const current = dupSvc.getThresholds(tenant);
  const newFuzzy = fuzzy_threshold !== undefined ? Number(fuzzy_threshold) : current.fuzzy_threshold;
  const newPhash = phash_distance  !== undefined ? Number(phash_distance)  : current.phash_distance;

  dupSvc.setThresholds(tenant, { fuzzy_threshold: newFuzzy, phash_distance: newPhash }, userId);

  // Audit
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, details, tenant_id) VALUES (?, ?, ?, ?, ?)'
  ).run(
    userId,
    'dedup_settings_update',
    'dedup_settings',
    JSON.stringify({ fuzzy_threshold: newFuzzy, phash_distance: newPhash }),
    tenant,
  );

  const updated = db.prepare(
    'SELECT tenant_id, fuzzy_threshold, phash_distance, updated_at, updated_by FROM dedup_settings WHERE tenant_id = ?'
  ).get(tenant);
  res.json(updated);
});

/**
 * GET /spa/api/admin/dedup-decisions
 * Returns the last 50 dedup decision rows for the tenant.
 */
router.get('/admin/dedup-decisions', requirePermJson('admin'), (req, res) => {
  const tenant = tenantScope(req);
  const rows = db.prepare(
    `SELECT id, tenant_id, doc_id, matched_doc_id, score, decision, created_at
     FROM dedup_decisions
     WHERE tenant_id = ?
     ORDER BY id DESC
     LIMIT 50`
  ).all(tenant);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Req 58 — Offline dead-letter queue admin
// ---------------------------------------------------------------------------

/**
 * GET /spa/api/admin/offline-dead-letter
 * Lists items in the dead-letter queue for the caller's tenant.
 */
router.get('/admin/offline-dead-letter', requirePermJson('admin'), async (req, res) => {
  const tenant = tenantScope(req);
  try {
    const items = await getDeadLetterItems(tenant);
    res.json({ tenant_id: tenant, count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

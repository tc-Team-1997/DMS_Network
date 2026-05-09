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
//
// Wire-format note: the SPA DedupSettingsSchema uses fuzzy_threshold as an
// integer percentage 0–100 (e.g. 80 means "80 %") while dupSvc stores it in
// the DB as a REAL fraction 0–1 (e.g. 0.8).  All conversion happens here:
//   - GET: DB value × 100  → response
//   - PUT: request value ÷ 100 → DB / dupSvc
//
// updated_by is stored as an integer user-id; the SPA expects a username
// string.  We JOIN to users on read and fall back to 'system' for null/seed rows.
// ---------------------------------------------------------------------------

/** Translate a DB dedup_settings row into the SPA wire shape. */
function _formatDedupRow(row, fallbackTenant) {
  const pct    = typeof row.fuzzy_threshold === 'number'
    ? Math.round(row.fuzzy_threshold * 100)
    : Math.round(dupSvc.DEFAULTS.fuzzy_threshold * 100);
  const phash  = typeof row.phash_distance === 'number'
    ? row.phash_distance
    : dupSvc.DEFAULTS.phash_distance;
  return {
    fuzzy_threshold: pct,
    phash_distance:  phash,
    updated_at:      row.updated_at  || new Date().toISOString(),
    updated_by:      row.updated_by  || 'system',
  };
}

/**
 * GET /spa/api/admin/dedup-settings
 * Returns the current thresholds for the caller's tenant.
 * fuzzy_threshold is returned as an integer percentage (0–100).
 * updated_by is resolved to a username string.
 */
router.get('/admin/dedup-settings', requirePermJson('admin'), (req, res) => {
  const tenant = tenantScope(req);
  const row = db.prepare(`
    SELECT d.tenant_id, d.fuzzy_threshold, d.phash_distance, d.updated_at,
           COALESCE(u.username, 'system') AS updated_by
    FROM dedup_settings d
    LEFT JOIN users u ON u.id = d.updated_by
    WHERE d.tenant_id = ?
  `).get(tenant);

  if (!row) {
    // Row missing (e.g. fresh DB before seed) — return sane defaults.
    return res.json({
      fuzzy_threshold: Math.round(dupSvc.DEFAULTS.fuzzy_threshold * 100),
      phash_distance:  dupSvc.DEFAULTS.phash_distance,
      updated_at:      new Date().toISOString(),
      updated_by:      'system',
    });
  }

  res.json(_formatDedupRow(row, tenant));
});

/**
 * PUT /spa/api/admin/dedup-settings
 * Body: { fuzzy_threshold: number (0–100), phash_distance: number (0–64) }
 * Validates, converts to internal scale, upserts, audits, and returns the
 * updated row in the same SPA wire shape.
 */
router.put('/admin/dedup-settings', requirePermJson('admin'), (req, res) => {
  const tenant = tenantScope(req);
  const userId = req.session.user.id;
  const { fuzzy_threshold, phash_distance } = req.body || {};

  // Validate — SPA sends percentage integers (0–100) and bit-counts (0–64).
  if (fuzzy_threshold === undefined || phash_distance === undefined) {
    return res.status(400).json({ error: 'fuzzy_threshold and phash_distance are required' });
  }
  const ftPct = Number(fuzzy_threshold);
  if (isNaN(ftPct) || ftPct < 0 || ftPct > 100 || !Number.isFinite(ftPct)) {
    return res.status(400).json({ error: 'fuzzy_threshold must be an integer between 0 and 100' });
  }
  const pd = Number(phash_distance);
  if (isNaN(pd) || pd < 0 || pd > 64 || !Number.isInteger(pd)) {
    return res.status(400).json({ error: 'phash_distance must be an integer between 0 and 64' });
  }

  // Convert percentage → fraction for dupSvc / DB storage.
  const ftFraction = ftPct / 100;

  dupSvc.setThresholds(tenant, { fuzzy_threshold: ftFraction, phash_distance: pd }, userId);

  // Audit — record the user-facing values so the log is human-readable.
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, details, tenant_id) VALUES (?, ?, ?, ?, ?)',
  ).run(
    userId,
    'DEDUP_SETTINGS_UPDATE',
    'dedup_settings',
    JSON.stringify({ fuzzy_threshold_pct: ftPct, phash_distance: pd }),
    tenant,
  );

  // Return the persisted row in SPA wire shape.
  const updated = db.prepare(`
    SELECT d.tenant_id, d.fuzzy_threshold, d.phash_distance, d.updated_at,
           COALESCE(u.username, 'system') AS updated_by
    FROM dedup_settings d
    LEFT JOIN users u ON u.id = d.updated_by
    WHERE d.tenant_id = ?
  `).get(tenant);

  res.json(_formatDedupRow(updated, tenant));
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
     LIMIT 50`,
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

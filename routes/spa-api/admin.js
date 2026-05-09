/**
 * System Admin ops. Health probes, audit viewer, retention trigger,
 * cache bust, dead-letter queue. Doc Admin only.
 *
 * dedup_settings table dropped in migration 0036 — dedup thresholds now live
 * in tenant_config namespace 'capture'. The legacy GET/PUT /admin/dedup-settings
 * endpoints have been replaced with CC1-backed equivalents that read/write
 * tenant_config directly via the DedupSettingsPage (using useTenantConfig).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { pyCall, requirePermJson, requireNamespacePermJson, tenantScope } = require('./_shared');
const { uploadsDir } = require('./documents');
const { getDeadLetterItems } = require('../../services/offline-queue');
const { setConfig, getNamespace } = require('../../db/tenant-config');
const dupSvc = require('../../services/duplicates');

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
// Dedup settings — CC1 backed (migration 0036: dedup_settings table dropped)
//
// The dedup_settings table was dropped in migration 0036. Thresholds now live
// in tenant_config namespace 'capture', keys 'dedup.fuzzy_min_ratio' (0–1)
// and 'dedup.phash_max_distance' (0–64).
//
// The SPA DedupSettingsPage reads via useTenantConfig('capture') directly.
// These legacy endpoints are kept as thin shims that read from tenant_config
// so older callers still work without a hard cut-over.
// ---------------------------------------------------------------------------

/**
 * GET /spa/api/admin/dedup-settings
 * Returns dedup thresholds from tenant_config namespace 'capture'.
 * fuzzy_threshold is returned as an integer percentage (0–100) for SPA compat.
 */
router.get('/admin/dedup-settings', requirePermJson('admin'), (req, res) => {
  const tenant = tenantScope(req);
  const thresholds = dupSvc.getThresholds(tenant);
  res.json({
    fuzzy_threshold: Math.round(thresholds.fuzzy_threshold * 100),
    phash_distance:  thresholds.phash_distance,
    updated_at:      new Date().toISOString(),
    updated_by:      'system',
  });
});

/**
 * PUT /spa/api/admin/dedup-settings
 * Body: { fuzzy_threshold: number (0–100), phash_distance: number (0–64) }
 * Writes through tenant_config via setConfig (CC1).
 */
router.put('/admin/dedup-settings', requirePermJson('admin'), (req, res) => {
  const tenant = tenantScope(req);
  const userId = req.session.user.id;
  const { fuzzy_threshold, phash_distance } = req.body || {};

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

  const ftFraction = ftPct / 100;
  const reason = `Admin updated dedup thresholds: fuzzy=${ftPct}% phash=${pd}`;

  try {
    setConfig(tenant, 'capture', 'dedup.fuzzy_min_ratio',    ftFraction, { actorUserId: userId, reason });
    setConfig(tenant, 'capture', 'dedup.phash_max_distance', pd,         { actorUserId: userId, reason });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, details, tenant_id) VALUES (?, ?, ?, ?, ?)',
  ).run(
    userId,
    'DEDUP_SETTINGS_UPDATE',
    'tenant_config',
    JSON.stringify({ fuzzy_threshold_pct: ftPct, phash_distance: pd }),
    tenant,
  );

  res.json({
    fuzzy_threshold: ftPct,
    phash_distance:  pd,
    updated_at:      new Date().toISOString(),
    updated_by:      req.session.user.username || 'system',
  });
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
// Retention rules — read/write per-doctype rules from tenant_config namespace
// 'retention'. Each doctype rule is stored as key 'rules.<doctype>' with
// value JSON of { retention_period_days, worm_lock_period_days,
//   legal_hold_eligible, delete_policy }.
// ---------------------------------------------------------------------------

/**
 * GET /spa/api/admin/retention/rules
 * Returns all per-doctype retention rules for the tenant.
 * Shape: { rules: Array<{ doctype, retention_period_days, worm_lock_period_days,
 *   legal_hold_eligible, delete_policy }> }
 */
router.get('/admin/retention/rules', requireNamespacePermJson('retention'), (req, res) => {
  const tenant = tenantScope(req);
  const cfg = getNamespace(tenant, 'retention') || {};
  const rules = [];
  for (const [k, v] of Object.entries(cfg)) {
    if (k.startsWith('rules.')) {
      const doctype = k.slice('rules.'.length);
      if (v && typeof v === 'object') {
        rules.push({ doctype, ...v });
      }
    }
  }
  // Also include any doctypes defined in retention_policies legacy table
  // (read-only, not editable here).
  res.json({ rules });
});

/**
 * PUT /spa/api/admin/retention/rules/:doctype
 * Body: { retention_period_days, worm_lock_period_days, legal_hold_eligible,
 *         delete_policy, reason }
 * Upserts a per-doctype retention rule in tenant_config namespace 'retention'.
 */
router.put('/admin/retention/rules/:doctype', requireNamespacePermJson('retention'), (req, res) => {
  const tenant = tenantScope(req);
  const userId = req.session.user.id;
  const doctype = req.params.doctype;
  if (!doctype || doctype.length > 64) {
    return res.status(400).json({ error: 'invalid doctype' });
  }

  const {
    retention_period_days,
    worm_lock_period_days,
    legal_hold_eligible,
    delete_policy,
    reason,
  } = req.body || {};

  if (!reason || typeof reason !== 'string' || reason.length < 20) {
    return res.status(400).json({ error: 'reason must be at least 20 characters' });
  }
  if (typeof retention_period_days !== 'number' || !Number.isFinite(retention_period_days) || retention_period_days < 1) {
    return res.status(400).json({ error: 'retention_period_days must be a positive number' });
  }
  const validPolicies = ['archive', 'cryptoshred', 'soft_delete'];
  if (delete_policy !== undefined && !validPolicies.includes(delete_policy)) {
    return res.status(400).json({ error: `delete_policy must be one of: ${validPolicies.join(', ')}` });
  }

  const ruleValue = {
    retention_period_days:  Math.round(retention_period_days),
    worm_lock_period_days:  typeof worm_lock_period_days === 'number' ? Math.round(worm_lock_period_days) : null,
    legal_hold_eligible:    legal_hold_eligible === true,
    delete_policy:          delete_policy || 'soft_delete',
  };

  try {
    setConfig(tenant, 'retention', `rules.${doctype}`, ruleValue, { actorUserId: userId, reason });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    userId, 'RETENTION_RULE_UPDATE', 'retention', null,
    JSON.stringify({ doctype, ...ruleValue }), tenant,
  );

  res.json({ doctype, ...ruleValue });
});

/**
 * GET /spa/api/admin/retention/sweep-status
 * Returns last sweep timestamp, count purged, count blocked by legal hold.
 * Reads from audit_log (RETENTION_TRIGGER and RETENTION_PURGE actions).
 */
router.get('/admin/retention/sweep-status', requireNamespacePermJson('retention'), (req, res) => {
  const tenant = tenantScope(req);

  const lastTrigger = db.prepare(`
    SELECT created_at, details FROM audit_log
    WHERE (action = 'RETENTION_TRIGGER' OR action = 'RETENTION_PURGE')
      AND (tenant_id = ? OR tenant_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
  `).get(tenant);

  // Count purge actions in last 24h / 7d / 30d
  const now = Date.now();
  const counts = {
    purged_today: 0,
    purged_week:  0,
    purged_month: 0,
    blocked_by_legal_hold: 0,
  };

  const recentPurges = db.prepare(`
    SELECT details, created_at FROM audit_log
    WHERE action = 'RETENTION_PURGE'
      AND (tenant_id = ? OR tenant_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 1000
  `).all(tenant);

  for (const row of recentPurges) {
    const age = now - new Date(row.created_at).getTime();
    if (age <= 86400000)     counts.purged_today++;
    if (age <= 7 * 86400000) counts.purged_week++;
    if (age <= 30 * 86400000) counts.purged_month++;
  }

  const blocked = db.prepare(`
    SELECT COUNT(*) AS c FROM audit_log
    WHERE action = 'RETENTION_BLOCKED_LEGAL_HOLD'
      AND (tenant_id = ? OR tenant_id IS NULL)
      AND created_at > datetime('now', '-30 days')
  `).get(tenant);
  counts.blocked_by_legal_hold = blocked ? blocked.c : 0;

  res.json({
    last_sweep_at: lastTrigger ? lastTrigger.created_at : null,
    ...counts,
  });
});

/**
 * GET /spa/api/admin/retention/purge-log
 * Returns recent retention action audit rows (last 200).
 */
router.get('/admin/retention/purge-log', requireNamespacePermJson('retention'), (req, res) => {
  const tenant = tenantScope(req);
  const limit = Math.min(parseInt(String(req.query.limit ?? 200), 10) || 200, 500);
  const rows = db.prepare(`
    SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at,
           u.username
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.action IN ('RETENTION_TRIGGER','RETENTION_PURGE','RETENTION_BLOCKED_LEGAL_HOLD',
                       'RETENTION_RULE_UPDATE','LEGAL_HOLD_APPLIED','LEGAL_HOLD_RELEASED',
                       'WORM_EXTENDED','WORM_LOCKED','WORM_UNLOCKED')
      AND (a.tenant_id = ? OR a.tenant_id IS NULL)
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(tenant, limit);
  res.json({ rows });
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

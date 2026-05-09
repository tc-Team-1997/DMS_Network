'use strict';

/**
 * GET /spa/api/dashboard/kpis
 *
 * Single endpoint for all Dashboard v2 data. Returns tiles, throughput,
 * funnel, heatmap, and confidence histogram in one round trip.
 *
 * Query params:
 *   tf      — timeframe: 1d | 7d | 30d | 90d | ytd   (default: 30d)
 *   compare — comparator: prior_period | prior_year | target | none  (default: none)
 *
 * All queries are scoped to req.session.user.tenant_id. This endpoint reads
 * the Node SQLite database (documents, workflows, audit_log, tenant_config).
 * AI confidence histogram uses documents.ocr_confidence as a proxy for
 * extraction confidence — the Python ocr_results table is not proxied here
 * because documents.ocr_confidence carries the same scalar per-doc value.
 *
 * Deviations documented:
 *   - audit_log has no `result` column; failures are approximated by
 *     action/details LIKE '%fail%'|'%error%'|'%denied%'.
 *   - OCR accuracy is labelled "AI confidence ≥threshold%" to reflect that
 *     ocr_confidence is model self-reported confidence, not ground-truth accuracy.
 *   - KYC p50 is computed over the most-recent 5000 approved workflows to
 *     bound query cost.
 */

const express = require('express');
const db = require('../../db');
const { tenantScope } = require('./_shared');
const { getNamespace } = require('../../db/tenant-config');

const router = express.Router();

// ─── Timeframe helpers ────────────────────────────────────────────────────────

/**
 * Returns the SQLite date string for the start of a timeframe,
 * optionally shifted by `shiftDays` to build prior-period windows.
 *
 * @param {'1d'|'7d'|'30d'|'90d'|'ytd'} tf
 * @param {number} shiftDays  — negative = shift back by N days
 * @returns {string}  SQLite date expression
 */
function tfStart(tf, shiftDays = 0) {
  const shift = shiftDays !== 0 ? `,${shiftDays > 0 ? '+' : ''}${shiftDays} days` : '';
  switch (tf) {
    case '1d':  return `date('now'${shift},'-1 days')`;
    case '7d':  return `date('now'${shift},'-7 days')`;
    case '30d': return `date('now'${shift},'-30 days')`;
    case '90d': return `date('now'${shift},'-90 days')`;
    case 'ytd': return `date('now'${shift},'start of year')`;
    default:    return `date('now'${shift},'-30 days')`;
  }
}

/** Number of calendar days in a timeframe window (for prior-period shift). */
function tfDays(tf) {
  switch (tf) {
    case '1d':  return 1;
    case '7d':  return 7;
    case '30d': return 30;
    case '90d': return 90;
    case 'ytd': return Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000);
    default:    return 30;
  }
}

// ─── Sparkline helpers ────────────────────────────────────────────────────────

/**
 * Generates N bucket labels and a per-bucket count from a simple COUNT query.
 * Used to build sparkline data for each tile.
 *
 * @param {string} tenant
 * @param {string} tf
 * @param {string} table         — 'documents' | 'workflows' | 'audit_log'
 * @param {string} dateCol       — column to bucket by (e.g. 'uploaded_at')
 * @param {string} whereExtra    — additional SQL predicate (no leading AND)
 * @returns {number[]}           — array of N counts (oldest → newest)
 */
function sparklineCounts(tenant, tf, table, dateCol, whereExtra = '1=1') {
  const days = Math.min(tfDays(tf), 30);
  const buckets = Math.min(days, 7); // max 7 points
  const daysPerBucket = Math.max(1, Math.floor(days / buckets));

  const rows = /** @type {{bucket: number, cnt: number}[]} */ (
    db.prepare(`
      SELECT
        CAST((julianday('now') - julianday(${dateCol})) / ${daysPerBucket} AS INTEGER) AS bucket,
        COUNT(*) AS cnt
      FROM ${table}
      WHERE tenant_id = ?
        AND ${dateCol} >= ${tfStart(tf)}
        AND (${whereExtra})
      GROUP BY bucket
      ORDER BY bucket DESC
    `).all(tenant)
  );

  // Map bucket index → count; fill gaps with 0; return oldest→newest
  const map = new Map(rows.map((r) => [r.bucket, r.cnt]));
  const result = [];
  for (let i = buckets - 1; i >= 0; i--) {
    result.push(map.get(i) ?? 0);
  }
  return result;
}

// ─── Tile computation ─────────────────────────────────────────────────────────

/**
 * @param {'on-track'|'at-risk'|'breach'} status
 */

/**
 * Resolves a target value from tenant_config, falling back to a default.
 * @param {Record<string, unknown>} cfg
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function cfgNum(cfg, key, fallback) {
  const v = cfg[key];
  return typeof v === 'number' ? v : fallback;
}

/**
 * Classify a value against alert/breach thresholds.
 * lowerIsBetter: true  → value > alert is at-risk, value > breach is breach
 * lowerIsBetter: false → value < alert is at-risk, value < breach is breach
 *
 * @param {number} value
 * @param {number} target
 * @param {number|null} alertThreshold
 * @param {number|null} breachThreshold
 * @param {boolean} lowerIsBetter
 * @returns {'on-track'|'at-risk'|'breach'}
 */
function classify(value, target, alertThreshold, breachThreshold, lowerIsBetter) {
  if (lowerIsBetter) {
    if (breachThreshold !== null && value > breachThreshold) return 'breach';
    if (alertThreshold !== null && value > alertThreshold) return 'at-risk';
    if (value <= target) return 'on-track';
    return 'at-risk';
  } else {
    if (breachThreshold !== null && value < breachThreshold) return 'breach';
    if (alertThreshold !== null && value < alertThreshold) return 'at-risk';
    if (value >= target) return 'on-track';
    return 'at-risk';
  }
}

/**
 * Computes the p50 KYC cycle time (hours) for approved workflows
 * within the given timeframe.  Uses an OFFSET approximation bounded
 * to the most recent 5000 rows so large tables don't thrash.
 *
 * @param {string} tenant
 * @param {string} tf
 * @param {string} startExpr  — SQLite date expression for window start
 * @returns {number|null}
 */
function kycP50(tenant, tf, startExpr) {
  const countRow = /** @type {{c: number}} */ (
    db.prepare(`
      SELECT COUNT(*) AS c FROM workflows
      WHERE stage = 'Approved' AND tenant_id = ? AND updated_at >= ${startExpr}
    `).get(tenant)
  );
  const total = countRow.c;
  if (total === 0) return null;

  const bounded = Math.min(total, 5000);
  const offset = Math.floor(bounded / 2);
  const row = /** @type {{cycle_h: number}|undefined} */ (
    db.prepare(`
      SELECT cycle_h FROM (
        SELECT (julianday(updated_at) - julianday(created_at)) * 24 AS cycle_h
        FROM workflows
        WHERE stage = 'Approved' AND tenant_id = ? AND updated_at >= ${startExpr}
        ORDER BY cycle_h
        LIMIT 5000
      ) LIMIT 1 OFFSET ?
    `).get(tenant, offset)
  );
  return row !== undefined ? Math.round(row.cycle_h * 10) / 10 : null;
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/dashboard/kpis', async (req, res) => {
  try {
    const tenant = tenantScope(req);
    const tf = ['1d', '7d', '30d', '90d', 'ytd'].includes(String(req.query.tf))
      ? String(req.query.tf)
      : '30d';
    const compare = ['prior_period', 'prior_year', 'target', 'none'].includes(String(req.query.compare))
      ? String(req.query.compare)
      : 'none';

    // Load tenant config (namespace 'dashboard') for targets.
    let cfg = {};
    try { cfg = getNamespace(tenant, 'dashboard'); } catch { /* no config yet */ }

    // ── Targets from config ───────────────────────────────────────────────────
    const targetKyc          = cfgNum(cfg, 'targets.kyc_cycle_p50_hours', 24);
    const targetAutomated    = cfgNum(cfg, 'targets.percent_automated', 75);
    const targetAiConf       = cfgNum(cfg, 'targets.ai_confidence', 75);
    const confidenceThreshold = cfgNum(cfg, 'targets.confidence_threshold', 0.7);
    const expiring30Alert    = cfgNum(cfg, 'targets.expiring_30d_alert', 50);
    const expiring30Breach   = cfgNum(cfg, 'targets.expiring_30d_breach', 100);
    const auditAlert         = cfgNum(cfg, 'targets.audit_failures_alert', 5);
    const auditBreach        = cfgNum(cfg, 'targets.audit_failures_breach', 20);

    // ── Date windows ─────────────────────────────────────────────────────────
    const startCurrent = tfStart(tf);
    const days = tfDays(tf);
    const startPrior = compare === 'prior_period'
      ? tfStart(tf, -days)
      : compare === 'prior_year'
        ? tfStart(tf, -365)
        : null;

    // ── Tile 1: KYC cycle time p50 ────────────────────────────────────────────
    const kycValue = kycP50(tenant, tf, startCurrent);
    const kycPrior = startPrior !== null ? kycP50(tenant, tf, startPrior) : null;
    const kycDelta = kycValue !== null && kycPrior !== null
      ? Math.round((kycValue - kycPrior) * 10) / 10
      : null;
    const kycSparkline = sparklineCounts(
      tenant, tf, 'workflows', 'updated_at', "stage = 'Approved'",
    );

    // ── Tile 2: % automated ────────────────────────────────────────────────────
    const autoRow = /** @type {{total: number, auto: number}} */ (
      db.prepare(`
        SELECT
          COUNT(*) AS total,
          COUNT(CASE WHEN ocr_confidence IS NOT NULL THEN 1 END) AS auto
        FROM documents
        WHERE tenant_id = ? AND uploaded_at >= ${startCurrent}
      `).get(tenant)
    );
    const autoValue = autoRow.total > 0
      ? Math.round((autoRow.auto / autoRow.total) * 1000) / 10
      : 0;
    const autoSparkline = sparklineCounts(
      tenant, tf, 'documents', 'uploaded_at', 'ocr_confidence IS NOT NULL',
    );
    // For delta: prior window
    let autoDelta = null;
    if (startPrior !== null) {
      const priorRow = /** @type {{total: number, auto: number}} */ (
        db.prepare(`
          SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN ocr_confidence IS NOT NULL THEN 1 END) AS auto
          FROM documents
          WHERE tenant_id = ? AND uploaded_at >= ${startPrior} AND uploaded_at < ${startCurrent}
        `).get(tenant)
      );
      const priorVal = priorRow.total > 0
        ? Math.round((priorRow.auto / priorRow.total) * 1000) / 10
        : 0;
      autoDelta = Math.round((autoValue - priorVal) * 10) / 10;
    }

    // ── Tile 3: AI confidence ≥threshold% ────────────────────────────────────
    const confRow = /** @type {{total: number, above: number}} */ (
      db.prepare(`
        SELECT
          COUNT(CASE WHEN ocr_confidence IS NOT NULL THEN 1 END) AS total,
          COUNT(CASE WHEN ocr_confidence >= ? THEN 1 END) AS above
        FROM documents
        WHERE tenant_id = ? AND uploaded_at >= ${startCurrent}
      `).get(confidenceThreshold, tenant)
    );
    const confValue = confRow.total > 0
      ? Math.round((confRow.above / confRow.total) * 1000) / 10
      : 0;
    const confSparkline = sparklineCounts(
      tenant, tf, 'documents', 'uploaded_at',
      `ocr_confidence >= ${confidenceThreshold}`,
    );
    let confDelta = null;
    if (startPrior !== null) {
      const priorConfRow = /** @type {{total: number, above: number}} */ (
        db.prepare(`
          SELECT
            COUNT(CASE WHEN ocr_confidence IS NOT NULL THEN 1 END) AS total,
            COUNT(CASE WHEN ocr_confidence >= ? THEN 1 END) AS above
          FROM documents
          WHERE tenant_id = ? AND uploaded_at >= ${startPrior} AND uploaded_at < ${startCurrent}
        `).get(confidenceThreshold, tenant)
      );
      const priorConfVal = priorConfRow.total > 0
        ? Math.round((priorConfRow.above / priorConfRow.total) * 1000) / 10
        : 0;
      confDelta = Math.round((confValue - priorConfVal) * 10) / 10;
    }

    // ── Tile 4: Expiring 30d ──────────────────────────────────────────────────
    const exp30Row = /** @type {{cnt: number}} */ (
      db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM documents
        WHERE tenant_id = ?
          AND expiry_date IS NOT NULL
          AND expiry_date BETWEEN date('now') AND date('now', '+30 days')
      `).get(tenant)
    );
    const exp30Value = exp30Row.cnt;

    // Prior: expiring-30d count from the prior window's perspective
    let exp30Delta = null;
    if (startPrior !== null) {
      const priorExp30Row = /** @type {{cnt: number}} */ (
        db.prepare(`
          SELECT COUNT(*) AS cnt
          FROM documents
          WHERE tenant_id = ?
            AND expiry_date IS NOT NULL
            AND expiry_date BETWEEN date('now', '-${days} days') AND date('now', '-${days} days', '+30 days')
        `).get(tenant)
      );
      exp30Delta = exp30Value - priorExp30Row.cnt;
    }
    const exp30Sparkline = sparklineCounts(
      tenant, tf, 'documents', 'uploaded_at',
      `expiry_date IS NOT NULL AND expiry_date BETWEEN date('now') AND date('now', '+30 days')`,
    );

    // ── Tile 5: Audit failures YTD ────────────────────────────────────────────
    // NOTE: audit_log has no `result` column. Failures are approximated by
    // action/details containing 'fail', 'error', or 'denied'. Tile subline
    // displays "(YTD, action contains fail/error/denied)" so admins understand.
    const auditRow = /** @type {{cnt: number}} */ (
      db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM audit_log
        WHERE tenant_id = ?
          AND strftime('%Y', created_at) = strftime('%Y', 'now')
          AND (
            action LIKE '%fail%' OR action LIKE '%error%' OR action LIKE '%denied%'
            OR details LIKE '%fail%' OR details LIKE '%error%' OR details LIKE '%denied%'
          )
      `).get(tenant)
    );
    const auditValue = auditRow.cnt;
    const auditSparkline = sparklineCounts(
      tenant, tf, 'audit_log', 'created_at',
      "action LIKE '%fail%' OR action LIKE '%error%' OR action LIKE '%denied%' OR details LIKE '%fail%' OR details LIKE '%error%' OR details LIKE '%denied%'",
    );
    // Delta for audit is always vs prior year (YTD metric)
    let auditDelta = null;
    if (compare !== 'none') {
      const priorAuditRow = /** @type {{cnt: number}} */ (
        db.prepare(`
          SELECT COUNT(*) AS cnt
          FROM audit_log
          WHERE tenant_id = ?
            AND strftime('%Y', created_at) = CAST(CAST(strftime('%Y', 'now') AS INTEGER) - 1 AS TEXT)
            AND (
              action LIKE '%fail%' OR action LIKE '%error%' OR action LIKE '%denied%'
              OR details LIKE '%fail%' OR details LIKE '%error%' OR details LIKE '%denied%'
            )
        `).get(tenant)
      );
      auditDelta = auditValue - priorAuditRow.cnt;
    }

    // ── Throughput vs SLA (14-day window, daily buckets) ──────────────────────
    const throughputRows = /** @type {{day: string, completed: number, sla_breach: number}[]} */ (
      db.prepare(`
        SELECT
          date(d.uploaded_at) AS day,
          COUNT(d.id)         AS completed,
          COUNT(CASE WHEN w.stage LIKE 'Rejected%'
                       OR (julianday('now') - julianday(d.uploaded_at)) > 3
                     THEN 1 END) AS sla_breach
        FROM documents d
        LEFT JOIN workflows w ON w.doc_id = d.id
        WHERE d.tenant_id = ?
          AND d.uploaded_at >= date('now', '-14 days')
        GROUP BY date(d.uploaded_at)
        ORDER BY day ASC
      `).all(tenant)
    );

    // ── Funnel: Capture → Approve ──────────────────────────────────────────────
    const funnelCaptured = /** @type {{cnt: number}} */ (
      db.prepare(`SELECT COUNT(*) AS cnt FROM documents WHERE tenant_id = ? AND uploaded_at >= ${startCurrent}`).get(tenant)
    ).cnt;
    const funnelClassified = /** @type {{cnt: number}} */ (
      db.prepare(`SELECT COUNT(*) AS cnt FROM documents WHERE tenant_id = ? AND uploaded_at >= ${startCurrent} AND ocr_confidence IS NOT NULL`).get(tenant)
    ).cnt;
    const funnelIndexed = /** @type {{cnt: number}} */ (
      db.prepare(`SELECT COUNT(*) AS cnt FROM documents WHERE tenant_id = ? AND uploaded_at >= ${startCurrent} AND status NOT IN ('Pending')`).get(tenant)
    ).cnt;
    const funnelApproved = /** @type {{cnt: number}} */ (
      db.prepare(`
        SELECT COUNT(DISTINCT w.doc_id) AS cnt
        FROM workflows w
        JOIN documents d ON d.id = w.doc_id
        WHERE d.tenant_id = ? AND d.uploaded_at >= ${startCurrent} AND w.stage = 'Approved'
      `).get(tenant)
    ).cnt;

    // ── Branch × DocType heatmap ───────────────────────────────────────────────
    const heatmapRows = /** @type {{branch: string, doc_type: string, cnt: number}[]} */ (
      db.prepare(`
        SELECT
          COALESCE(branch, 'Unknown')   AS branch,
          COALESCE(doc_type, 'Other')   AS doc_type,
          COUNT(*)                       AS cnt
        FROM documents
        WHERE tenant_id = ?
          AND status NOT IN ('Approved', 'Archived')
          AND uploaded_at >= ${startCurrent}
        GROUP BY branch, doc_type
        ORDER BY cnt DESC
        LIMIT 200
      `).all(tenant)
    );

    // ── AI confidence histogram (7-day, documents.ocr_confidence as proxy) ────
    const confHistRows = /** @type {{band: string, cnt: number}[]} */ (
      db.prepare(`
        SELECT
          CASE
            WHEN ocr_confidence < 0.4  THEN 'lt40'
            WHEN ocr_confidence < 0.7  THEN '40to70'
            WHEN ocr_confidence < 0.9  THEN '70to90'
            ELSE                            'gte90'
          END AS band,
          COUNT(*) AS cnt
        FROM documents
        WHERE tenant_id = ?
          AND ocr_confidence IS NOT NULL
          AND uploaded_at >= date('now', '-7 days')
        GROUP BY band
      `).all(tenant)
    );
    const bandMap = Object.fromEntries(confHistRows.map((r) => [r.band, r.cnt]));
    const confidenceHistogram = {
      lt40:    bandMap['lt40']    ?? 0,
      c40to70: bandMap['40to70'] ?? 0,
      c70to90: bandMap['70to90'] ?? 0,
      gte90:   bandMap['gte90']  ?? 0,
    };

    // ── Assemble response ─────────────────────────────────────────────────────
    res.json({
      timeframe: tf,
      comparator: compare,
      tiles: {
        kyc_cycle: {
          value:    kycValue,
          delta:    kycDelta,
          sparkline: kycSparkline,
          target:   targetKyc,
          status:   kycValue !== null
            ? classify(kycValue, targetKyc, targetKyc * 1.25, targetKyc * 1.5, true)
            : 'on-track',
        },
        percent_automated: {
          value:    autoValue,
          delta:    autoDelta,
          sparkline: autoSparkline,
          target:   targetAutomated,
          status:   classify(autoValue, targetAutomated, targetAutomated * 0.9, targetAutomated * 0.75, false),
        },
        ai_confidence: {
          value:    confValue,
          delta:    confDelta,
          sparkline: confSparkline,
          target:   targetAiConf,
          threshold: confidenceThreshold,
          status:   classify(confValue, targetAiConf, targetAiConf * 0.9, targetAiConf * 0.75, false),
        },
        expiring_30d: {
          value:    exp30Value,
          delta:    exp30Delta,
          sparkline: exp30Sparkline,
          target:   expiring30Alert,
          status:   classify(exp30Value, expiring30Alert, expiring30Alert, expiring30Breach, true),
        },
        audit_failures_ytd: {
          value:    auditValue,
          delta:    auditDelta,
          sparkline: auditSparkline,
          target:   0,
          status:   classify(auditValue, 0, auditAlert, auditBreach, true),
        },
      },
      throughput:             throughputRows,
      funnel: [
        { stage: 'Captured',   count: funnelCaptured },
        { stage: 'Classified', count: funnelClassified },
        { stage: 'Indexed',    count: funnelIndexed },
        { stage: 'Approved',   count: funnelApproved },
      ],
      heatmap:                heatmapRows,
      confidence_histogram:   confidenceHistogram,
    });
  } catch (err) {
    console.error('[dashboard/kpis] error:', err);
    res.status(500).json({ error: 'dashboard_kpis_failed', detail: err.message });
  }
});

module.exports = router;

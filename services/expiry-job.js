/**
 * Expiry cron — runs daily at 02:00 and marks documents Expired / Expiring.
 *
 * Migration 0032 (DocTypes v2) added `notify_days TEXT DEFAULT '30,60,90'`
 * to document_type_schemas.  This job now reads per-doctype bands instead of
 * the old hardcoded 90-day ceiling, closing UI/UX review line #14.
 *
 * Algorithm:
 *   1. Mark all past-expiry documents as Expired.
 *   2. For every active doctype schema, parse its notify_days CSV.
 *      For each band N, find documents of that type with expiry_date within
 *      N days and emit a labelled alert ("expiring in <=30 days", etc.).
 *   3. Documents whose doc_type is not registered use default bands [30,60,90].
 */
const cron = require('node-cron');
const db = require('../db');
const { broadcastByRole } = require('./notify');

/**
 * Parse a comma-separated string of positive integers.
 * Returns a sorted, deduplicated array.  Falls back to [30, 60, 90].
 * @param {string|null|undefined} raw
 * @returns {number[]}
 */
function parseNotifyDays(raw) {
  if (!raw || typeof raw !== 'string') return [30, 60, 90];
  const parts = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return [30, 60, 90];
  return [...new Set(parts)].sort((a, b) => a - b);
}

function scanExpiries() {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // ── 1. Mark past-expiry documents as Expired ───────────────────────────────
  const expired = db
    .prepare(
      "UPDATE documents SET status='Expired' WHERE expiry_date IS NOT NULL AND expiry_date < ? AND status != 'Expired'",
    )
    .run(todayIso);

  if (expired.changes > 0) {
    const title = `${expired.changes} document(s) newly expired`;
    db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)').run(
      'critical',
      title,
      'Auto scan · compliance risk',
    );
    broadcastByRole('nbe', 'Doc Admin', 'expiry_alert', { count: expired.changes, doc_type: 'all', band: '0 days (past expiry)' }).catch((e) => console.error('[expiry-job] notify error:', e.message));
  }

  // ── 2. Per-doctype notify_days bands ───────────────────────────────────────
  // Fetch all active doctypes.  For each one, iterate its notify_days bands
  // and query documents of that type whose expiry_date falls within the band.
  const doctypes = db
    .prepare(
      'SELECT name, notify_days FROM document_type_schemas WHERE active = 1',
    )
    .all();

  /** @type {Map<string, number[]>} */
  const bandMap = new Map();
  for (const dt of doctypes) {
    bandMap.set(dt.name, parseNotifyDays(dt.notify_days));
  }

  // Track which doc IDs we've already counted — a doc expiring within both a
  // 30-day and a 60-day band is only emitted under the tightest matching band.
  const alreadyAlerted = new Set();
  let totalExpiring = 0;

  for (const [typeName, bands] of bandMap) {
    for (const band of bands) {
      const future = new Date(today.getTime() + band * 86_400_000);
      const futureIso = future.toISOString().slice(0, 10);

      const rows = db
        .prepare(
          `SELECT id FROM documents
            WHERE doc_type = ?
              AND expiry_date IS NOT NULL
              AND expiry_date >= ?
              AND expiry_date <= ?
              AND status NOT IN ('Expired')`,
        )
        .all(typeName, todayIso, futureIso);

      const newRows = rows.filter((r) => !alreadyAlerted.has(r.id));
      if (newRows.length === 0) continue;

      for (const r of newRows) alreadyAlerted.add(r.id);

      db.prepare(
        `UPDATE documents SET status='Expiring'
          WHERE id IN (${newRows.map(() => '?').join(',')})
            AND status NOT IN ('Expiring','Expired')`,
      ).run(...newRows.map((r) => r.id));

      totalExpiring += newRows.length;

      const bandLabel = `${band} day${band === 1 ? '' : 's'}`;
      const alertTitle = `${newRows.length} ${typeName} document(s) expiring in <=${bandLabel}`;
      db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)').run(
        band <= 7 ? 'critical' : 'warning',
        alertTitle,
        `Auto scan · notify_days=${bands.join(',')}`,
      );
    }
  }

  // ── 3. Catch-all for unknown / unregistered doc_type ─────────────────────
  // These use default bands [30, 60, 90] so no document falls through.
  const knownTypes = [...bandMap.keys()];
  const defaultBands = [30, 60, 90];

  for (const band of defaultBands) {
    const future = new Date(today.getTime() + band * 86_400_000);
    const futureIso = future.toISOString().slice(0, 10);

    const notInClause = knownTypes.length > 0
      ? `AND doc_type NOT IN (${knownTypes.map(() => '?').join(',')})`
      : '';

    const sql = `SELECT id FROM documents
      WHERE expiry_date IS NOT NULL
        AND expiry_date >= ?
        AND expiry_date <= ?
        AND status NOT IN ('Expired')
        ${notInClause}`;

    const params = [todayIso, futureIso, ...knownTypes];
    const rows = db.prepare(sql).all(...params);
    const newRows = rows.filter((r) => !alreadyAlerted.has(r.id));
    if (newRows.length === 0) continue;

    for (const r of newRows) alreadyAlerted.add(r.id);

    db.prepare(
      `UPDATE documents SET status='Expiring'
        WHERE id IN (${newRows.map(() => '?').join(',')})
          AND status NOT IN ('Expiring','Expired')`,
    ).run(...newRows.map((r) => r.id));

    totalExpiring += newRows.length;

    db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)').run(
      'warning',
      `${newRows.length} document(s) (unregistered type) expiring in <=${band} days`,
      'Auto scan · default bands [30,60,90]',
    );
  }

  console.log(
    `[expiry-job] expired=${expired.changes} expiring=${totalExpiring}`,
  );
  return { expired: expired.changes, expiring: totalExpiring };
}

function start() {
  cron.schedule('0 2 * * *', scanExpiries);
  console.log('[expiry-job] scheduled daily at 02:00 (per-doctype notify_days)');
}

module.exports = { start, scanExpiries };

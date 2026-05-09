/**
 * Indexing Station — API surface (Wave B, migration 0034).
 *
 * Endpoints:
 *   GET  /indexing                — claim queue (includes lock status)
 *   GET  /indexing/stats          — triage metric counts
 *   GET  /indexing/:id/analysis   — per-field AI confidence from metadata_json
 *   POST /indexing/:id/claim      — acquire claim lock (race-safe via PK)
 *   DELETE /indexing/:id/claim    — release claim lock + beacon release
 *   PATCH /indexing/:id           — save field edits (lock-ownership enforced)
 */
'use strict';

const express = require('express');
const db = require('../../db');
const { branchScope, requirePermJson } = require('./_shared');
const { getConfig } = require('../../db/tenant-config');

const router = express.Router();

// Default claim lock TTL when not set in tenant_config.
const DEFAULT_LOCK_TTL_MINUTES = 15;

// Columns a Maker / Indexer can legitimately edit during triage.
const EDITABLE_FIELDS = [
  'doc_type', 'customer_cid', 'customer_name', 'doc_number',
  'dob', 'issue_date', 'expiry_date', 'issuing_authority', 'notes',
];

// ---------------------------------------------------------------------------
// Prepared statements — created once at module load for performance.
// ---------------------------------------------------------------------------

const stmtQueueBase = (scope, onlyLowConf, limitN) => {
  // We build the SQL dynamically but bind all values — no string interpolation
  // of user data.
  let sql = `
    SELECT
      d.id, d.filename, d.original_name, d.doc_type, d.customer_cid, d.customer_name,
      d.doc_number, d.dob, d.issue_date, d.expiry_date, d.issuing_authority,
      d.branch, d.status, d.ocr_confidence, d.uploaded_at, d.notes,
      il.user_name  AS lock_user_name,
      il.expires_at AS lock_expires_at,
      il.user_id    AS lock_user_id
    FROM documents d
    LEFT JOIN indexing_locks il
           ON il.doc_id = d.id
          AND il.expires_at > datetime('now')
    WHERE (
      d.ocr_confidence IS NULL
      OR d.ocr_confidence < 70
      OR d.doc_type IS NULL
      OR (d.customer_name IS NULL AND d.customer_cid IS NULL)
      OR d.doc_number IS NULL
    )
  `;
  const params = [];
  if (scope) { sql += ' AND d.branch = ?'; params.push(scope); }
  if (onlyLowConf) { sql += ' AND (d.ocr_confidence IS NULL OR d.ocr_confidence < 70)'; }
  sql += ' ORDER BY d.uploaded_at DESC LIMIT ?';
  params.push(limitN);
  return { sql, params };
};

// ---------------------------------------------------------------------------
// GET /indexing
// ---------------------------------------------------------------------------

router.get('/indexing', (req, res) => {
  const scope = branchScope(req.session.user);
  const limit = Math.min(parseInt(String(req.query.limit ?? 100), 10) || 100, 500);
  const onlyLowConf = String(req.query.low_conf ?? '') === '1';

  const { sql, params } = stmtQueueBase(scope, onlyLowConf, limit);
  const rows = db.prepare(sql).all(...params);

  // Shape each row: attach lock as a nested object (null when not locked).
  const shaped = rows.map((r) => {
    const lock = r.lock_user_name != null
      ? { user_name: r.lock_user_name, user_id: r.lock_user_id, expires_at: r.lock_expires_at }
      : null;
    const { lock_user_name: _a, lock_expires_at: _b, lock_user_id: _c, ...rest } = r;
    return { ...rest, lock };
  });

  res.json(shaped);
});

// ---------------------------------------------------------------------------
// GET /indexing/stats
// ---------------------------------------------------------------------------

router.get('/indexing/stats', (req, res) => {
  const scope = branchScope(req.session.user);
  const branchClause = scope ? ' AND branch = ?' : '';
  const p = scope ? [scope] : [];
  const count = (extra) =>
    db.prepare(
      `SELECT COUNT(*) c FROM documents WHERE 1=1 ${extra}${branchClause}`,
    ).get(...p).c;

  res.json({
    low_confidence: count('AND (ocr_confidence IS NULL OR ocr_confidence < 70)'),
    missing_type:   count('AND doc_type IS NULL'),
    missing_owner:  count('AND customer_name IS NULL AND customer_cid IS NULL'),
    missing_number: count('AND doc_number IS NULL'),
  });
});

// ---------------------------------------------------------------------------
// GET /indexing/:id/analysis
// Returns per-field AI confidence extracted from documents.metadata_json._ai_fields.
// Falls back to empty fields when DocBrain hasn't run yet.
// ---------------------------------------------------------------------------

router.get('/indexing/:id/analysis', requirePermJson('index'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const doc = db.prepare('SELECT id, metadata_json FROM documents WHERE id = ?').get(id);
  if (!doc) return res.status(404).json({ error: 'not_found' });

  let aiFields = null;
  if (typeof doc.metadata_json === 'string' && doc.metadata_json.trim()) {
    try {
      const meta = JSON.parse(doc.metadata_json);
      if (meta && typeof meta === 'object' && meta._ai_fields) {
        aiFields = meta._ai_fields;
      }
    } catch {
      // malformed JSON — treat as not-yet-analysed
    }
  }

  // Normalise to the wire shape the SPA expects.
  const KNOWN_FIELDS = [
    'doc_type', 'customer_cid', 'customer_name', 'doc_number',
    'dob', 'issue_date', 'expiry_date', 'issuing_authority', 'notes',
  ];

  const fields = Object.fromEntries(
    KNOWN_FIELDS.map((key) => {
      if (aiFields && Object.prototype.hasOwnProperty.call(aiFields, key)) {
        const f = aiFields[key];
        return [key, {
          value:      f.value ?? null,
          confidence: typeof f.confidence === 'number' ? f.confidence : 0,
          // bbox will be added by DocBrain v2 — absent for now
        }];
      }
      return [key, { value: null, confidence: 0 }];
    }),
  );

  res.json({ document_id: id, fields });
});

// ---------------------------------------------------------------------------
// POST /indexing/:id/claim — acquire claim lock
// ---------------------------------------------------------------------------

router.post('/indexing/:id/claim', requirePermJson('index'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const doc = db.prepare('SELECT id, branch FROM documents WHERE id = ?').get(id);
  if (!doc) return res.status(404).json({ error: 'not_found' });

  // Branch scoping.
  const scope = branchScope(req.session.user);
  if (scope && doc.branch !== scope) {
    return res.status(403).json({ error: 'out_of_branch' });
  }

  const tenantId = req.session.user.tenant_id || 'nbe';
  const ttlMinutes = (() => {
    try {
      const v = getConfig(tenantId, 'indexing', 'claim_lock_ttl_minutes', DEFAULT_LOCK_TTL_MINUTES);
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOCK_TTL_MINUTES;
    } catch {
      return DEFAULT_LOCK_TTL_MINUTES;
    }
  })();

  const userId = req.session.user.id;
  const userName = req.session.user.full_name || req.session.user.username;

  // Atomic transaction: sweep expired → try insert → read winner.
  const claimTx = db.transaction(() => {
    // 1. Sweep expired locks for this doc only (global sweep runs every 60s).
    db.prepare(
      "DELETE FROM indexing_locks WHERE doc_id = ? AND expires_at < datetime('now')",
    ).run(id);

    // 2. Attempt insert — PK conflict = someone else holds it.
    const expiresExpr = `datetime('now', '+${ttlMinutes} minutes')`;
    db.prepare(
      `INSERT OR IGNORE INTO indexing_locks (doc_id, user_id, user_name, claimed_at, expires_at)
       VALUES (?, ?, ?, datetime('now'), ${expiresExpr})`,
    ).run(id, userId, userName);

    // 3. Read back whoever actually holds the lock.
    return db.prepare(
      'SELECT user_id, user_name, expires_at FROM indexing_locks WHERE doc_id = ?',
    ).get(id);
  });

  const lock = claimTx();

  if (!lock) {
    // No lock row means insert succeeded but read came back empty — shouldn't
    // happen, but handle defensively.
    return res.status(409).json({ error: 'claim_failed' });
  }

  if (lock.user_id !== userId) {
    return res.status(409).json({
      error: 'locked',
      lock: { user_name: lock.user_name, expires_at: lock.expires_at },
    });
  }

  res.json({ ok: true, expires_at: lock.expires_at, ttl_minutes: ttlMinutes });
});

// ---------------------------------------------------------------------------
// DELETE /indexing/:id/claim — release claim lock
// Accepts both DELETE (fetch/axios) and POST with _method=DELETE (beacon).
// The SPA sends a beacon on beforeunload (POST to this endpoint with a
// _beacon=1 marker) because navigator.sendBeacon only supports POST.
// ---------------------------------------------------------------------------

function releaseLock(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const userId = req.session.user?.id;
  if (!userId) return res.status(401).json({ error: 'unauthenticated' });

  db.prepare(
    'DELETE FROM indexing_locks WHERE doc_id = ? AND user_id = ?',
  ).run(id, userId);

  res.json({ ok: true });
}

router.delete('/indexing/:id/claim', requirePermJson('index'), releaseLock);

// Beacon endpoint: navigator.sendBeacon posts to a URL; we accept a POST with
// a query param ?_beacon=1 and treat it as a release.  Auth is via session
// cookie (same-origin, withCredentials).
router.post('/indexing/:id/claim/release', requirePermJson('index'), releaseLock);

// ---------------------------------------------------------------------------
// PATCH /indexing/:id — save field edits
// Lock ownership: if a live lock exists for this doc, only the lock holder
// may write. If no lock exists (unclaimed), writes through freely (backward
// compat — the old list UI never acquires locks).
// ---------------------------------------------------------------------------

router.patch('/indexing/:id', requirePermJson('index'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const doc = db.prepare('SELECT id, branch FROM documents WHERE id = ?').get(id);
  if (!doc) return res.status(404).json({ error: 'not_found' });

  // Branch scoping.
  const scope = branchScope(req.session.user);
  if (scope && doc.branch !== scope) {
    return res.status(403).json({ error: 'out_of_branch' });
  }

  // Lock-ownership check (only enforced when an active lock exists).
  const activeLock = db.prepare(
    "SELECT user_id, user_name FROM indexing_locks WHERE doc_id = ? AND expires_at > datetime('now')",
  ).get(id);
  if (activeLock && activeLock.user_id !== req.session.user.id) {
    return res.status(409).json({
      error: 'locked',
      lock: { user_name: activeLock.user_name },
    });
  }

  const body = req.body ?? {};
  const updates = [];
  const values = [];
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates.push(`${field} = ?`);
      values.push(body[field] === '' ? null : body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'no_fields' });
  values.push(id);

  db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
  ).run(req.session.user.id, 'INDEX_UPDATE', 'document', id, JSON.stringify(body));

  res.json({ ok: true });
});

module.exports = router;

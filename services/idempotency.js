/**
 * services/idempotency.js
 *
 * Server-side idempotency helpers for the offline-sync-queue feature (BHU-57).
 *
 * The idempotency_keys table must exist in the DB before this module is first
 * used.  db/index.js creates the table via the bootstrap block it already owns.
 * Team lead: paste the CREATE TABLE block from the report into db/index.js
 * inside the try { … } block alongside the other ddl.exec() calls.
 *
 * Three exported functions:
 *   getIdempotency(key, requestHash, tenantId, userId)
 *     → null                     (no record)
 *     → { match: true, row }     (same hash — cache hit)
 *     → { match: false }         (hash collision — caller should 409)
 *
 *   storeIdempotency({ key, tenantId, userId, endpoint, requestHash,
 *                      responseStatus, responseBody })
 *     → void
 *
 *   pruneExpired()
 *     → { deleted: N }
 *
 * Pruning is triggered once on module import (lazy, async-safe) and then
 * every PRUNE_INTERVAL_MS via setInterval.  The interval is deliberately
 * unref()'d so it never prevents process exit in tests.
 */
'use strict';

const crypto = require('crypto');
const db     = require('../db');

// ---------------------------------------------------------------------------
// Table bootstrap — idempotent, safe to call on every import.
//
// Schema note (2026-05-09 v1.1 hardening): primary key is the composite
// (tenant_id, user_id, key). The original v1 shape had `key TEXT PRIMARY
// KEY` which made the client UUID globally unique across all tenants —
// two users from different tenants with the same UUID would collide on
// the PK and silently fail INSERT OR IGNORE, masking real dedup bugs.
// The composite PK enforces idempotency per-(tenant, user) without
// cross-tenant collision risk. Existing v1 rows have ≤ 24h TTL and are
// short-lived state; this migration drops the v1 table on first boot
// after upgrade and recreates with the new shape.
// ---------------------------------------------------------------------------
try {
  // Detect v1 shape: single-column PK on `key`.
  const cols = db.prepare("PRAGMA table_info(idempotency_keys)").all();
  const keyCol = cols.find((c) => c.name === 'key');
  const pkCount = cols.filter((c) => c.pk > 0).length;
  if (keyCol && keyCol.pk === 1 && pkCount === 1) {
    db.exec('DROP TABLE idempotency_keys');
  }
} catch (e) {
  // First-boot path — table doesn't exist yet; CREATE below makes it.
}

db.exec(`
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             TEXT NOT NULL,
    tenant_id       TEXT NOT NULL DEFAULT 'default',
    user_id         INTEGER NOT NULL REFERENCES users(id),
    endpoint        TEXT NOT NULL,
    request_hash    TEXT NOT NULL,
    response_status INTEGER,
    response_body   TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id, key)
  );
  CREATE INDEX IF NOT EXISTS idx_idem_user_created
    ON idempotency_keys(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_idem_expires
    ON idempotency_keys(expires_at);
`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a SHA-256 hex digest of an arbitrary JS value. */
function sha256(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** ISO timestamp 24 hours from now. */
function expiresIn24h() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Look up an idempotency key scoped to tenant + user.
 *
 * @param {string} key          - client UUID
 * @param {string} requestHash  - sha256 of canonical request payload
 * @param {string} tenantId
 * @param {number} userId
 * @returns {null | { match: true, row: object } | { match: false }}
 */
function getIdempotency(key, requestHash, tenantId, userId) {
  const row = db.prepare(
    `SELECT * FROM idempotency_keys
      WHERE key = ? AND tenant_id = ? AND user_id = ?
        AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1`
  ).get(key, tenantId, userId);

  if (!row) return null;
  if (row.request_hash === requestHash) return { match: true, row };
  return { match: false };
}

/**
 * Persist an idempotency record after a successful (or terminal-failure)
 * request.  Uses INSERT OR IGNORE so concurrent replays of the exact same
 * key+hash don't race — first writer wins.
 *
 * @param {object} opts
 * @param {string}  opts.key
 * @param {string}  opts.tenantId
 * @param {number}  opts.userId
 * @param {string}  opts.endpoint        e.g. 'POST /spa/api/documents'
 * @param {string}  opts.requestHash
 * @param {number}  opts.responseStatus
 * @param {object|string} opts.responseBody
 */
function storeIdempotency({ key, tenantId, userId, endpoint, requestHash, responseStatus, responseBody }) {
  const bodyStr = typeof responseBody === 'string'
    ? responseBody
    : JSON.stringify(responseBody);

  db.prepare(
    `INSERT OR IGNORE INTO idempotency_keys
       (key, tenant_id, user_id, endpoint, request_hash,
        response_status, response_body, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(key, tenantId, userId, endpoint, requestHash, responseStatus, bodyStr, expiresIn24h());
}

/**
 * Delete all rows whose expires_at is in the past.
 * @returns {{ deleted: number }}
 */
function pruneExpired() {
  const result = db.prepare(
    `DELETE FROM idempotency_keys WHERE expires_at <= CURRENT_TIMESTAMP`
  ).run();
  return { deleted: result.changes };
}

// ---------------------------------------------------------------------------
// Re-export sha256 helper so callers can build the same hash without
// duplicating the algorithm.
// ---------------------------------------------------------------------------
module.exports = { getIdempotency, storeIdempotency, pruneExpired, sha256 };

// ---------------------------------------------------------------------------
// Prune on import (fire-and-forget via setImmediate to avoid blocking
// require()) then every hour.
// ---------------------------------------------------------------------------
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

setImmediate(() => {
  try {
    const { deleted } = pruneExpired();
    if (deleted > 0) console.log(`[idempotency] pruned ${deleted} expired key(s) on boot`);
  } catch (err) {
    console.error('[idempotency] boot prune error:', err.message);
  }
});

const _pruneTimer = setInterval(() => {
  try {
    const { deleted } = pruneExpired();
    if (deleted > 0) console.log(`[idempotency] pruned ${deleted} expired key(s)`);
  } catch (err) {
    console.error('[idempotency] prune error:', err.message);
  }
}, PRUNE_INTERVAL_MS);

// Allow the process to exit even while this interval is pending.
if (_pruneTimer.unref) _pruneTimer.unref();

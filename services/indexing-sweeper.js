'use strict';

/**
 * Indexing Station — lock sweeper (migration 0034).
 *
 * Runs every SWEEP_INTERVAL_MS (default 60 s) and deletes expired
 * indexing_locks rows. The server-side TTL is the safety net for tabs
 * that close without firing the SPA's beforeunload beacon.
 *
 * Started from server.js alongside the expiry-job and retention sweepers.
 */

const db = require('../db');

const SWEEP_INTERVAL_MS = 60_000;

const _sweepStmt = db.prepare(
  "DELETE FROM indexing_locks WHERE expires_at < datetime('now')",
);

function sweepExpiredLocks() {
  try {
    const info = _sweepStmt.run();
    if (info.changes > 0) {
      console.log(`[indexing-sweeper] released ${info.changes} expired lock(s)`);
    }
  } catch (err) {
    // Non-fatal: log and continue. The table may not exist on first boot
    // before seed.js has run; the next tick will succeed.
    console.warn('[indexing-sweeper] sweep error:', err.message);
  }
}

let _timer = null;

function start() {
  if (_timer !== null) return; // idempotent
  _timer = setInterval(sweepExpiredLocks, SWEEP_INTERVAL_MS);
  // Unref so the timer does not prevent process exit in tests.
  if (typeof _timer.unref === 'function') _timer.unref();
}

function stop() {
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, sweepExpiredLocks };

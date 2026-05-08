/**
 * Node-side duplicate detection helpers.
 *
 * Thresholds are read live from `dedup_settings` per tenant so admin changes
 * take effect on the next comparison without a restart.  When the row is
 * missing the defaults 0.8 (fuzzy) / 10 (phash) are used — identical to the
 * hard-coded constants that existed before Req 44-45.
 *
 * The heavy-lifting SHA-256 / pHash comparison lives in the Python service.
 * This module supplies the tunable constants to Node-side code that needs them
 * (e.g. the offline-sync background worker, any future pre-upload check).
 */
'use strict';

const db = require('../db');

const DEFAULTS = {
  fuzzy_threshold: 0.8,
  phash_distance:  10,
};

/**
 * Return the effective dedup thresholds for a given tenant.
 * Always returns {fuzzy_threshold, phash_distance}.
 *
 * @param {string} [tenantId='nbe']
 * @returns {{ fuzzy_threshold: number, phash_distance: number }}
 */
function getThresholds(tenantId = 'nbe') {
  try {
    const row = db.prepare(
      'SELECT fuzzy_threshold, phash_distance FROM dedup_settings WHERE tenant_id = ?'
    ).get(tenantId);
    if (!row) return { ...DEFAULTS };
    return {
      fuzzy_threshold: typeof row.fuzzy_threshold === 'number' ? row.fuzzy_threshold : DEFAULTS.fuzzy_threshold,
      phash_distance:  typeof row.phash_distance  === 'number' ? row.phash_distance  : DEFAULTS.phash_distance,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Upsert dedup thresholds for a tenant.
 *
 * @param {string} tenantId
 * @param {{ fuzzy_threshold?: number, phash_distance?: number }} fields
 * @param {number|null} updatedBy  — user.id of the admin making the change
 */
function setThresholds(tenantId, { fuzzy_threshold, phash_distance } = {}, updatedBy = null) {
  db.prepare(`
    INSERT INTO dedup_settings (tenant_id, fuzzy_threshold, phash_distance, updated_by, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_id) DO UPDATE SET
      fuzzy_threshold = excluded.fuzzy_threshold,
      phash_distance  = excluded.phash_distance,
      updated_by      = excluded.updated_by,
      updated_at      = CURRENT_TIMESTAMP
  `).run(
    tenantId,
    typeof fuzzy_threshold === 'number' ? fuzzy_threshold : DEFAULTS.fuzzy_threshold,
    typeof phash_distance  === 'number' ? phash_distance  : DEFAULTS.phash_distance,
    updatedBy,
  );
}

/**
 * Write a decision row after a dedup check.
 *
 * @param {{ tenantId, docId, matchedDocId?, score?, decision }} opts
 */
function writeDecision({ tenantId = 'nbe', docId, matchedDocId = null, score = null, decision }) {
  db.prepare(
    `INSERT INTO dedup_decisions (tenant_id, doc_id, matched_doc_id, score, decision)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tenantId, docId, matchedDocId, score, decision);
}

module.exports = { getThresholds, setThresholds, writeDecision, DEFAULTS };

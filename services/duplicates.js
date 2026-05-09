/**
 * Node-side duplicate detection helpers.
 *
 * Threshold precedence (highest → lowest):
 *   1. tenant_config namespace 'capture', keys 'dedup.fuzzy_min_ratio' and
 *      'dedup.phash_max_distance'  (CC1 source of truth — set via Admin UI)
 *   2. dedup_settings table (legacy per-tenant row, managed via
 *      PUT /spa/api/admin/dedup-settings)
 *   3. DEFAULTS constants below
 *
 * Wave B cleanup flag: dedup_settings is now legacy. Values should migrate
 * into tenant_config.capture.dedup.* during Wave B and the table dropped in a
 * follow-up migration once all tenants have been migrated.
 *
 * The heavy-lifting SHA-256 / pHash comparison lives in the Python service.
 * This module supplies the tunable constants to Node-side code that needs them
 * (e.g. the offline-sync background worker, any future pre-upload check).
 */
'use strict';

const db = require('../db');
const { getNamespace } = require('../db/tenant-config');

const DEFAULTS = {
  fuzzy_threshold: 0.8,
  phash_distance:  10,
};

/**
 * Return the effective dedup thresholds for a given tenant.
 * Always returns {fuzzy_threshold, phash_distance}.
 *
 * Precedence: tenant_config (CC1) > dedup_settings table (legacy) > DEFAULTS.
 * dedup_settings is owed a migration into tenant_config; flagged for Wave B.
 *
 * @param {string} [tenantId='nbe']
 * @returns {{ fuzzy_threshold: number, phash_distance: number }}
 */
function getThresholds(tenantId = 'nbe') {
  try {
    // (1) CC1 tenant_config namespace 'capture'
    const cfg = getNamespace(tenantId, 'capture') || {};
    const fuzzyTC = typeof cfg['dedup.fuzzy_min_ratio'] === 'number'
      ? cfg['dedup.fuzzy_min_ratio']
      : undefined;
    const phashTC = typeof cfg['dedup.phash_max_distance'] === 'number'
      ? cfg['dedup.phash_max_distance']
      : undefined;

    // (2) Legacy dedup_settings table
    const legacyRow = db.prepare(
      'SELECT fuzzy_threshold, phash_distance FROM dedup_settings WHERE tenant_id = ?'
    ).get(tenantId);

    return {
      fuzzy_threshold: fuzzyTC
        ?? (typeof legacyRow?.fuzzy_threshold === 'number' ? legacyRow.fuzzy_threshold : undefined)
        ?? DEFAULTS.fuzzy_threshold,
      phash_distance: phashTC
        ?? (typeof legacyRow?.phash_distance === 'number' ? legacyRow.phash_distance : undefined)
        ?? DEFAULTS.phash_distance,
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

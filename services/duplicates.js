/**
 * Node-side duplicate detection helpers.
 *
 * Threshold precedence (highest → lowest):
 *   1. tenant_config namespace 'capture', keys 'dedup.fuzzy_min_ratio' and
 *      'dedup.phash_max_distance'  (CC1 source of truth — set via Admin UI)
 *   2. DEFAULTS constants below
 *
 * dedup_settings legacy table dropped in migration 0036; values are now in
 * tenant_config.capture.dedup.*. The legacy fallback path has been removed.
 *
 * The heavy-lifting SHA-256 / pHash comparison lives in the Python service.
 * This module supplies the tunable constants to Node-side code that needs them
 * (e.g. the offline-sync background worker, any future pre-upload check).
 */
'use strict';

const { getNamespace } = require('../db/tenant-config');

const DEFAULTS = {
  fuzzy_threshold: 0.8,
  phash_distance:  10,
};

/**
 * Return the effective dedup thresholds for a given tenant.
 * Always returns {fuzzy_threshold, phash_distance}.
 *
 * Precedence: tenant_config (CC1) > DEFAULTS.
 *
 * @param {string} [tenantId='nbe']
 * @returns {{ fuzzy_threshold: number, phash_distance: number }}
 */
function getThresholds(tenantId = 'nbe') {
  try {
    // CC1 tenant_config namespace 'capture'
    const cfg = getNamespace(tenantId, 'capture') || {};
    const fuzzyTC = typeof cfg['dedup.fuzzy_min_ratio'] === 'number'
      ? cfg['dedup.fuzzy_min_ratio']
      : undefined;
    const phashTC = typeof cfg['dedup.phash_max_distance'] === 'number'
      ? cfg['dedup.phash_max_distance']
      : undefined;

    return {
      fuzzy_threshold: fuzzyTC ?? DEFAULTS.fuzzy_threshold,
      phash_distance:  phashTC ?? DEFAULTS.phash_distance,
    };
  } catch {
    return { ...DEFAULTS };
  }
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

module.exports = { getThresholds, writeDecision, DEFAULTS };

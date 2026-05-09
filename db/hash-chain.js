/**
 * Shared hash-chain utility.
 *
 * Canonical JSON + SHA-256 chain algorithm used by:
 *   - db/tenant-config.js  (tenant_config_history table)
 *   - routes/spa-api/audit.js  (audit_log table, migration 0038+)
 *
 * Algorithm (mirrors Python services/tenant_config/service.py):
 *   canonical_json = JSON.stringify(rowDict, sortedReplacer, 0)
 *   hash = sha256( (prevHash || '') + canonical_json )
 *
 * Keys are sorted lexicographically so the digest is deterministic
 * regardless of insertion order. This matches:
 *   json.dumps(obj, sort_keys=True, separators=(',',':'))
 * in Python, and the browser-side Web Crypto verifier in ChainVerifyBadge.tsx.
 */

'use strict';

const crypto = require('crypto');

/**
 * Canonical JSON: keys sorted lexicographically, no whitespace.
 * Handles nested objects recursively.
 *
 * @param {unknown} obj
 * @returns {string}
 */
function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sorted = Object.keys(obj)
    .sort()
    .reduce((acc, k) => {
      acc[k] = obj[k];
      return acc;
    }, /** @type {Record<string,unknown>} */ ({}));
  return JSON.stringify(sorted, (_, v) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v)
        .sort()
        .reduce((acc, k) => {
          acc[k] = v[k];
          return acc;
        }, /** @type {Record<string,unknown>} */ ({}));
    }
    return v;
  });
}

/**
 * Compute the SHA-256 chain hash for a row.
 *
 * @param {string|null|undefined} prevHash  - hash of the previous row (null for first)
 * @param {Record<string,unknown>} rowDict  - the row fields that form the canonical payload
 * @returns {string} hex SHA-256 digest
 */
function computeHash(prevHash, rowDict) {
  const payload = (prevHash || '') + canonicalJson(rowDict);
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

module.exports = { canonicalJson, computeHash };

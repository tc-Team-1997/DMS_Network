'use strict';

/**
 * GET /spa/api/tenant-public
 *
 * Anonymous endpoint — no session required.
 * Returns the public-safe subset of the default active tenant.
 *
 * TODO Phase 2: hostname-based tenant routing — for now, return the first
 * active tenant ordered by tenant_id ASC.
 *
 * Public fields: everything in the tenants table is public-safe (no user PII).
 * We intentionally exclude `is_active`, `created_at`, `updated_at` — callers
 * don't need operational metadata.
 *
 * Exports:
 *   module.exports          — Express router (consumed by spa-api.js via router.use())
 *   module.exports.loadDefaultTenant — loader function (consumed by auth.js, server.js)
 *   module.exports.loadTenant        — loader function (consumed by auth.js, server.js)
 *
 * Putting named exports on the router function is idiomatic CommonJS when you
 * need both a router and helper functions from the same module.
 */

const express = require('express');
const db = require('../../db');
const { getNamespace } = require('../../db/tenant-config');

const router = express.Router();

const TENANT_FIELDS = `
  tenant_id, slug, display_name, regulator_name, regulator_short,
  default_locale, allowed_locales, primary_color, monogram,
  logo_path, favicon_path, login_banner, footer_text, environment_label
`;

function _parseTenant(row) {
  return {
    ...row,
    allowed_locales: (() => {
      try { return JSON.parse(row.allowed_locales); } catch { return ['en']; }
    })(),
  };
}

/**
 * Load the default active tenant. Result is cached in module scope so
 * unauthenticated requests (e.g. login page loads) hit the DB only once per
 * process lifetime. Cache is invalidated only on process restart — acceptable
 * given how rarely tenant branding changes.
 *
 * @returns {{ tenant_id, slug, display_name, ... } | null}
 */
let _cachedDefaultTenant = null;

function loadDefaultTenant() {
  if (_cachedDefaultTenant) return _cachedDefaultTenant;
  const row = db.prepare(
    // TODO Phase 2: hostname-based tenant routing — for now, return the first active tenant.
    `SELECT ${TENANT_FIELDS} FROM tenants WHERE is_active = 1 ORDER BY tenant_id ASC LIMIT 1`
  ).get();
  if (!row) return null;
  const tenant = _parseTenant(row);
  _cachedDefaultTenant = tenant;
  return tenant;
}

/**
 * Load a specific tenant by tenant_id. Falls back to the default if not found.
 */
function loadTenant(tenantId) {
  if (!tenantId) return loadDefaultTenant();
  const row = db.prepare(
    `SELECT ${TENANT_FIELDS} FROM tenants WHERE tenant_id = ? AND is_active = 1`
  ).get(tenantId);
  if (!row) return loadDefaultTenant();
  return _parseTenant(row);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.get('/tenant-public', (req, res) => {
  let tenant = loadDefaultTenant();
  if (!tenant) {
    return res.status(503).json({ error: 'no_active_tenant' });
  }
  // CC7 fix: merge tenant_config branding overrides for anonymous callers.
  // This ensures login page branding reflects any Settings changes.
  const brandingOverrides = getNamespace(tenant.tenant_id, 'branding') || {};
  tenant = { ...tenant, ...brandingOverrides };
  return res.json(tenant);
});

// Attach loader helpers as named properties on the router so callers can
// destructure them: const { loadTenant } = require('./tenant-public');
// This is safe because router is a Function and Function is an Object.
router.loadDefaultTenant = loadDefaultTenant;
router.loadTenant = loadTenant;

module.exports = router;

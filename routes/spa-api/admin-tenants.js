/**
 * Admin tenant CRUD endpoints.
 *
 * GET  /spa/api/admin/tenants              → list all tenants
 * POST /spa/api/admin/tenants              → create tenant (reason >=20 chars)
 * PUT  /spa/api/admin/tenants/:tenant_id   → update tenant fields (reason >=20 chars)
 *
 * RBAC: requireNamespacePermJson('tenants') — today only Doc Admin.
 *
 * Audit trail: every field change is written to tenant_config_history via
 * CC1's setConfig (namespace='_tenant_meta'). This keeps the entire
 * configuration audit trail unified in one table with hash-chain integrity.
 *
 * Delete is intentionally absent — deactivate via is_active=0 instead
 * (soft delete, preserves audit trail).
 */

'use strict';

const express = require('express');
const db = require('../../db');
const { requireNamespacePermJson, tenantScope } = require('./_shared');
const { setConfig } = require('../../db/tenant-config');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Columns the API exposes. tenant_id is immutable after creation.
 * allowed_locales is stored as a JSON string in the DB; we parse it outbound.
 */
const PUBLIC_COLS = [
  'tenant_id',
  'slug',
  'display_name',
  'regulator_name',
  'regulator_short',
  'default_locale',
  'allowed_locales',
  'primary_color',
  'monogram',
  'logo_path',
  'favicon_path',
  'login_banner',
  'footer_text',
  'environment_label',
  'is_active',
  'created_at',
  'updated_at',
];

/** Mutable fields accepted on POST/PUT. tenant_id is set by caller on POST. */
const MUTABLE_FIELDS = [
  'slug',
  'display_name',
  'regulator_name',
  'regulator_short',
  'default_locale',
  'allowed_locales',
  'primary_color',
  'monogram',
  'logo_path',
  'favicon_path',
  'login_banner',
  'footer_text',
  'environment_label',
  'is_active',
];

function serializeTenant(row) {
  if (!row) return null;
  return {
    ...row,
    // allowed_locales is stored as JSON string; parse it for the API response.
    allowed_locales: typeof row.allowed_locales === 'string'
      ? JSON.parse(row.allowed_locales)
      : (row.allowed_locales ?? ['en']),
    is_active: row.is_active === 1 || row.is_active === true,
  };
}

const stmtList = db.prepare(
  `SELECT ${PUBLIC_COLS.join(', ')} FROM tenants ORDER BY display_name ASC`
);

const stmtGetOne = db.prepare(
  `SELECT ${PUBLIC_COLS.join(', ')} FROM tenants WHERE tenant_id = ?`
);

// ---------------------------------------------------------------------------
// GET /spa/api/admin/tenants
// ---------------------------------------------------------------------------

router.get('/admin/tenants', requireNamespacePermJson('tenants'), (req, res) => {
  try {
    const rows = stmtList.all();
    return res.json({ tenants: rows.map(serializeTenant) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/admin/tenants
// ---------------------------------------------------------------------------

router.post('/admin/tenants', requireNamespacePermJson('tenants'), (req, res) => {
  const actorUserId = req.session.user.id;
  const body = req.body || {};

  const { tenant_id, reason } = body;

  if (!tenant_id || typeof tenant_id !== 'string' || !/^[a-z0-9_-]+$/.test(tenant_id.trim())) {
    return res.status(400).json({ error: 'tenant_id is required and must match [a-z0-9_-]+' });
  }
  if (!reason || typeof reason !== 'string' || reason.length < 20) {
    return res.status(400).json({ error: 'reason must be at least 20 characters' });
  }

  const tid = tenant_id.trim();
  const now = new Date().toISOString();

  // Collect field values, applying defaults where omitted.
  const fields = {
    slug:              (body.slug          || tid).trim(),
    display_name:      (body.display_name  || '').trim(),
    regulator_name:    (body.regulator_name  || '').trim(),
    regulator_short:   (body.regulator_short || '').trim(),
    default_locale:    (body.default_locale  || 'en').trim(),
    allowed_locales:   JSON.stringify(
                         Array.isArray(body.allowed_locales)
                           ? body.allowed_locales
                           : ['en']
                       ),
    primary_color:     (body.primary_color   || '#0D2B6A').trim(),
    monogram:          (body.monogram        || tid.slice(0, 2).toUpperCase()).trim(),
    logo_path:         body.logo_path        ?? null,
    favicon_path:      body.favicon_path     ?? null,
    login_banner:      body.login_banner     ?? null,
    footer_text:       body.footer_text      ?? null,
    environment_label: body.environment_label ?? null,
    is_active:         body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
  };

  if (!fields.display_name) {
    return res.status(400).json({ error: 'display_name is required' });
  }
  if (!fields.regulator_name || !fields.regulator_short) {
    return res.status(400).json({ error: 'regulator_name and regulator_short are required' });
  }

  const insert = db.prepare(`
    INSERT INTO tenants
      (tenant_id, slug, display_name, regulator_name, regulator_short,
       default_locale, allowed_locales, primary_color, monogram,
       logo_path, favicon_path, login_banner, footer_text, environment_label,
       is_active, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    const writeAll = db.transaction(() => {
      insert.run(
        tid,
        fields.slug,
        fields.display_name,
        fields.regulator_name,
        fields.regulator_short,
        fields.default_locale,
        fields.allowed_locales,
        fields.primary_color,
        fields.monogram,
        fields.logo_path,
        fields.favicon_path,
        fields.login_banner,
        fields.footer_text,
        fields.environment_label,
        fields.is_active,
        now,
        now,
      );

      // Audit trail: record each field via CC1's setConfig hash chain.
      for (const [fieldName, fieldValue] of Object.entries(fields)) {
        setConfig(tid, '_tenant_meta', fieldName, String(fieldValue ?? ''), {
          actorUserId,
          reason,
        });
      }
    });
    writeAll();

    const created = stmtGetOne.get(tid);
    return res.status(201).json({ tenant: serializeTenant(created) });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'tenant_id or slug already exists' });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /spa/api/admin/tenants/:tenant_id
// ---------------------------------------------------------------------------

router.put('/admin/tenants/:tenant_id', requireNamespacePermJson('tenants'), (req, res) => {
  const actorUserId = req.session.user.id;
  const { tenant_id } = req.params;
  const body = req.body || {};
  const { reason } = body;

  if (!reason || typeof reason !== 'string' || reason.length < 20) {
    return res.status(400).json({ error: 'reason must be at least 20 characters' });
  }

  const existing = stmtGetOne.get(tenant_id);
  if (!existing) {
    return res.status(404).json({ error: 'tenant not found' });
  }

  // Build update set from only the mutable fields present in the request body.
  // Exclude tenant_id (immutable) and reason (not a tenant column).
  const updates = {};
  for (const field of MUTABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field) && field !== 'reason') {
      if (field === 'is_active') {
        updates[field] = body[field] ? 1 : 0;
      } else if (field === 'allowed_locales') {
        updates[field] = JSON.stringify(
          Array.isArray(body[field]) ? body[field] : [body[field] || 'en']
        );
      } else {
        updates[field] = body[field] ?? null;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'no updatable fields provided' });
  }

  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), new Date().toISOString(), tenant_id];

  const stmtUpdate = db.prepare(
    `UPDATE tenants SET ${setClauses}, updated_at = ? WHERE tenant_id = ?`
  );

  try {
    const writeAll = db.transaction(() => {
      stmtUpdate.run(...values);

      // Audit trail via CC1's setConfig hash chain.
      for (const [fieldName, fieldValue] of Object.entries(updates)) {
        setConfig(tenant_id, '_tenant_meta', fieldName, String(fieldValue ?? ''), {
          actorUserId,
          reason,
        });
      }
    });
    writeAll();

    const updated = stmtGetOne.get(tenant_id);
    return res.json({ tenant: serializeTenant(updated) });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'slug already in use by another tenant' });
    }
    const isValidation = err.message.startsWith('Validation error') ||
                         err.message.startsWith('reason must be') ||
                         err.message.startsWith('validator:');
    return res.status(isValidation ? 400 : 500).json({ error: err.message });
  }
});

module.exports = router;

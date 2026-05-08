/**
 * Document-type schemas — admin-configurable per-type field definitions
 * that drive the Capture form. Fields are stored as JSON so adding a new
 * field does not require a code change or migration.
 *
 * Every schema is an ordered array of:
 *   {
 *     key: string,                // column-safe identifier
 *     label: string,              // rendered in the form
 *     type: 'text' | 'textarea' | 'date' | 'number' | 'email' | 'tel',
 *     required: boolean,
 *     ai_extract_from?: string    // one of DocBrain's 8 extraction keys
 *   }
 *
 * Endpoints:
 *   GET    /document-types              list (session-auth)
 *   GET    /document-types/:id          one  (session-auth)
 *   POST   /document-types              create (admin)
 *   PATCH  /document-types/:id          update (admin)
 *   DELETE /document-types/:id          delete (admin, if unused)
 */
const express = require('express');
const db = require('../../db');
const { requirePermJson, tenantScope } = require('./_shared');

const router = express.Router();

const FIELD_TYPES = new Set(['text', 'textarea', 'date', 'number', 'email', 'tel']);
const AI_EXTRACT_KEYS = new Set([
  'customer_cid', 'customer_name', 'doc_number', 'dob',
  'issue_date', 'expiry_date', 'issuing_authority', 'address',
]);
const KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;

function hydrate(row) {
  if (!row) return null;
  let fields = [];
  try { fields = JSON.parse(row.fields_json || '[]'); } catch { fields = []; }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields,
    active: row.active ? 1 : 0,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateFields(raw) {
  if (!Array.isArray(raw)) return { ok: false, error: 'fields_must_be_array' };
  if (raw.length > 40) return { ok: false, error: 'too_many_fields' };
  const seen = new Set();
  const cleaned = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'field_not_object' };
    const key = typeof f.key === 'string' ? f.key.trim().toLowerCase() : '';
    if (!KEY_RE.test(key)) return { ok: false, error: `invalid_key:${key}` };
    if (seen.has(key)) return { ok: false, error: `duplicate_key:${key}` };
    seen.add(key);
    const label = typeof f.label === 'string' ? f.label.trim() : '';
    if (!label) return { ok: false, error: `missing_label:${key}` };
    const type = typeof f.type === 'string' ? f.type : '';
    if (!FIELD_TYPES.has(type)) return { ok: false, error: `invalid_type:${type}` };
    const required = !!f.required;
    const cleanedField = { key, label: label.slice(0, 120), type, required };
    if (f.ai_extract_from) {
      if (!AI_EXTRACT_KEYS.has(f.ai_extract_from)) {
        return { ok: false, error: `invalid_ai_extract_from:${f.ai_extract_from}` };
      }
      cleanedField.ai_extract_from = f.ai_extract_from;
    }
    cleaned.push(cleanedField);
  }
  return { ok: true, fields: cleaned };
}

// ---------- reads (any logged-in user) ------------------------------------

router.get('/document-types', (req, res) => {
  const tenant = tenantScope(req);
  const onlyActive = String(req.query.active ?? '') === '1';
  let sql =
    'SELECT * FROM document_type_schemas WHERE tenant_id = ?';
  const params = [tenant];
  if (onlyActive) sql += ' AND active = 1';
  sql += ' ORDER BY name ASC';
  res.json(db.prepare(sql).all(...params).map(hydrate));
});

router.get('/document-types/:id', (req, res) => {
  const tenant = tenantScope(req);
  const row = db.prepare(
    'SELECT * FROM document_type_schemas WHERE id = ? AND tenant_id = ?',
  ).get(parseInt(req.params.id, 10), tenant);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(hydrate(row));
});

// ---------- writes (admin only) -------------------------------------------

router.post('/document-types', requirePermJson('admin'), (req, res) => {
  const { name, description, fields, active } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name_required' });
  }
  const check = validateFields(fields ?? []);
  if (!check.ok) return res.status(400).json({ error: check.error });

  const tenant = tenantScope(req);
  try {
    const info = db.prepare(
      `INSERT INTO document_type_schemas
         (name, description, fields_json, active, tenant_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      name.trim().slice(0, 80),
      (typeof description === 'string' ? description.slice(0, 500) : null),
      JSON.stringify(check.fields),
      active === false ? 0 : 1,
      tenant,
    );
    const row = db.prepare('SELECT * FROM document_type_schemas WHERE id = ?')
      .get(info.lastInsertRowid);
    res.status(201).json(hydrate(row));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'name_taken' });
    res.status(500).json({ error: 'insert_failed', detail: err.message });
  }
});

router.patch('/document-types/:id', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tenant = tenantScope(req);
  const existing = db.prepare(
    'SELECT * FROM document_type_schemas WHERE id = ? AND tenant_id = ?',
  ).get(id, tenant);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body ?? {};
  const sets = [];
  const values = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?');
    values.push(body.name.trim().slice(0, 80));
  }
  if ('description' in body) {
    sets.push('description = ?');
    values.push(
      typeof body.description === 'string' ? body.description.slice(0, 500) : null,
    );
  }
  if ('fields' in body) {
    const check = validateFields(body.fields);
    if (!check.ok) return res.status(400).json({ error: check.error });
    sets.push('fields_json = ?');
    values.push(JSON.stringify(check.fields));
  }
  if ('active' in body) {
    sets.push('active = ?');
    values.push(body.active ? 1 : 0);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  try {
    db.prepare(
      `UPDATE document_type_schemas SET ${sets.join(', ')} WHERE id = ?`,
    ).run(...values);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'name_taken' });
    throw err;
  }
  const updated = db.prepare('SELECT * FROM document_type_schemas WHERE id = ?').get(id);
  res.json(hydrate(updated));
});

router.delete('/document-types/:id', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tenant = tenantScope(req);
  const existing = db.prepare(
    'SELECT name FROM document_type_schemas WHERE id = ? AND tenant_id = ?',
  ).get(id, tenant);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Guard against orphaning documents — fail the delete if anything is
  // currently classified under this type.
  const used = db.prepare(
    'SELECT COUNT(*) AS c FROM documents WHERE doc_type = ? AND tenant_id = ?',
  ).get(existing.name, tenant).c;
  if (used > 0) return res.status(409).json({ error: 'type_in_use', doc_count: used });

  db.prepare('DELETE FROM document_type_schemas WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.validateFields = validateFields;
module.exports.FIELD_TYPES = FIELD_TYPES;
module.exports.AI_EXTRACT_KEYS = AI_EXTRACT_KEYS;

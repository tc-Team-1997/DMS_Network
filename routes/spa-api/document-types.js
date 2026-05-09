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
 *   PATCH  /document-types/:id          update (admin) — also accepts autofill_floor,
 *                                         high_confidence, tested_with_sample_id
 *   DELETE /document-types/:id          delete (admin, if unused)
 *   POST   /document-types/:id/test-thresholds  proxy to Python (view perm)
 */
const express = require('express');
const db = require('../../db');
const { pyCall, requirePermJson, tenantScope } = require('./_shared');

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
    default_folder_id: row.default_folder_id ?? null,
    default_folder_name: row.default_folder_name ?? null,
    // OCR confidence threshold fields (migration 0020 / ocr-confidence-tuning)
    autofill_floor: row.autofill_floor ?? 0.4,
    high_confidence: row.high_confidence ?? 0.7,
    tested_with_sample_id: row.tested_with_sample_id ?? null,
  };
}

/**
 * Validate threshold fields present in a PATCH body.
 * Returns { ok: true } or { ok: false, status: number, error: string }.
 *
 * Rules (contract ocr-confidence-tuning §8 / §5):
 *   - autofill_floor  in [0, 1]
 *   - high_confidence in [0, 1]
 *   - autofill_floor < high_confidence  (strictly; equal is rejected per task spec)
 *   - tested_with_sample_id — positive integer or null
 *   - If tested_with_sample_id is a positive integer it must reference a row in
 *     document_type_samples whose schema_id matches the doctype being patched.
 *
 * `doctypeId` is required only when tested_with_sample_id is being validated.
 */
function validateThresholds(body, doctypeId, tenantId) {
  const hasFloor  = 'autofill_floor'  in body;
  const hasHigh   = 'high_confidence' in body;
  const hasSample = 'tested_with_sample_id' in body;

  const floor = hasFloor ? body.autofill_floor  : undefined;
  const high  = hasHigh  ? body.high_confidence : undefined;

  if (hasFloor) {
    if (typeof floor !== 'number' || !Number.isFinite(floor) || floor < 0 || floor > 1) {
      return { ok: false, status: 400, error: 'invalid_autofill_floor' };
    }
  }
  if (hasHigh) {
    if (typeof high !== 'number' || !Number.isFinite(high) || high < 0 || high > 1) {
      return { ok: false, status: 400, error: 'invalid_high_confidence' };
    }
  }

  // Cross-field: autofill_floor must be strictly less than high_confidence.
  // When both are present the check is straightforward. When only one is
  // supplied the caller merges in the existing DB value before calling here.
  if (hasFloor && hasHigh) {
    if (floor >= high) {
      return { ok: false, status: 400, error: 'invalid_thresholds' };
    }
  }

  if (hasSample) {
    const sid = body.tested_with_sample_id;
    if (sid !== null) {
      const sidInt = parseInt(sid, 10);
      if (!Number.isFinite(sidInt) || sidInt <= 0) {
        return { ok: false, status: 400, error: 'invalid_tested_with_sample_id' };
      }
      // Verify the sample belongs to this doctype AND this tenant — explicit
      // defense-in-depth, even though doctype is already tenant-scoped (the
      // join through schema_id transitively enforces tenant isolation, but
      // Commandment #1 demands the filter is visible in every query).
      const sampleRow = db.prepare(
        `SELECT s.id
           FROM document_type_samples s
           JOIN document_type_schemas d ON d.id = s.schema_id
          WHERE s.id = ? AND s.schema_id = ? AND d.tenant_id = ?`,
      ).get(sidInt, doctypeId, tenantId || 'default');
      if (!sampleRow) {
        return { ok: false, status: 400, error: 'sample_not_found' };
      }
    }
  }

  return { ok: true };
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
    `SELECT s.*, f.name AS default_folder_name
       FROM document_type_schemas s
       LEFT JOIN folders f ON f.id = s.default_folder_id
      WHERE s.tenant_id = ?`;
  const params = [tenant];
  if (onlyActive) sql += ' AND s.active = 1';
  sql += ' ORDER BY s.name ASC';
  res.json(db.prepare(sql).all(...params).map(hydrate));
});

router.get('/document-types/:id', (req, res) => {
  const tenant = tenantScope(req);
  const row = db.prepare(
    `SELECT s.*, f.name AS default_folder_name
       FROM document_type_schemas s
       LEFT JOIN folders f ON f.id = s.default_folder_id
      WHERE s.id = ? AND s.tenant_id = ?`,
  ).get(parseInt(req.params.id, 10), tenant);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(hydrate(row));
});

// ---------- writes (admin only) -------------------------------------------

router.post('/document-types', requirePermJson('admin'), (req, res) => {
  const { name, description, fields, active, default_folder_id } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name_required' });
  }
  const check = validateFields(fields ?? []);
  if (!check.ok) return res.status(400).json({ error: check.error });

  // Validate default_folder_id when supplied.
  let resolvedDefaultFolderId = null;
  if (default_folder_id != null) {
    const fid = parseInt(default_folder_id, 10);
    if (!Number.isFinite(fid) || fid <= 0) {
      return res.status(400).json({ error: 'invalid_default_folder_id' });
    }
    const folderRow = db.prepare('SELECT id FROM folders WHERE id = ?').get(fid);
    if (!folderRow) return res.status(400).json({ error: 'default_folder_not_found' });
    resolvedDefaultFolderId = fid;
  }

  const tenant = tenantScope(req);
  try {
    const info = db.prepare(
      `INSERT INTO document_type_schemas
         (name, description, fields_json, active, tenant_id, default_folder_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      name.trim().slice(0, 80),
      (typeof description === 'string' ? description.slice(0, 500) : null),
      JSON.stringify(check.fields),
      active === false ? 0 : 1,
      tenant,
      resolvedDefaultFolderId,
    );
    const row = db.prepare(
      `SELECT s.*, f.name AS default_folder_name
         FROM document_type_schemas s
         LEFT JOIN folders f ON f.id = s.default_folder_id
        WHERE s.id = ?`,
    ).get(info.lastInsertRowid);
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

  // ── Standard fields ──────────────────────────────────────────────────────
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
  if ('default_folder_id' in body) {
    if (body.default_folder_id == null) {
      sets.push('default_folder_id = ?');
      values.push(null);
    } else {
      const fid = parseInt(body.default_folder_id, 10);
      if (!Number.isFinite(fid) || fid <= 0) {
        return res.status(400).json({ error: 'invalid_default_folder_id' });
      }
      const folderRow = db.prepare('SELECT id FROM folders WHERE id = ?').get(fid);
      if (!folderRow) return res.status(400).json({ error: 'default_folder_not_found' });
      sets.push('default_folder_id = ?');
      values.push(fid);
    }
  }

  // ── OCR confidence threshold fields (contract: ocr-confidence-tuning §5) ─
  //
  // Cross-field constraint: autofill_floor must be strictly < high_confidence.
  // When only one of the pair is in the request we merge in the current DB
  // value (falling back to schema defaults) so the cross-field check fires
  // correctly even for single-field updates.
  const hasFloor  = 'autofill_floor'  in body;
  const hasHigh   = 'high_confidence' in body;
  const hasSample = 'tested_with_sample_id' in body;

  if (hasFloor || hasHigh || hasSample) {
    const effectiveBody = Object.assign({}, body);
    if (hasFloor && !hasHigh) {
      effectiveBody.high_confidence = existing.high_confidence ?? 0.7;
    }
    if (hasHigh && !hasFloor) {
      effectiveBody.autofill_floor = existing.autofill_floor ?? 0.4;
    }

    const thresholdCheck = validateThresholds(effectiveBody, id, existing.tenant_id);
    if (!thresholdCheck.ok) {
      return res.status(thresholdCheck.status).json({ error: thresholdCheck.error });
    }

    if (hasFloor) {
      sets.push('autofill_floor = ?');
      values.push(body.autofill_floor);
    }
    if (hasHigh) {
      sets.push('high_confidence = ?');
      values.push(body.high_confidence);
    }
    if (hasSample) {
      sets.push('tested_with_sample_id = ?');
      values.push(
        body.tested_with_sample_id === null
          ? null
          : parseInt(body.tested_with_sample_id, 10),
      );
    }
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

  const updated = db.prepare(
    `SELECT s.*, f.name AS default_folder_name
       FROM document_type_schemas s
       LEFT JOIN folders f ON f.id = s.default_folder_id
      WHERE s.id = ?`,
  ).get(id);

  // ── Audit log for threshold changes (contract §8 / security) ────────────
  // Write an audit row only when at least one threshold field was touched.
  if (hasFloor || hasHigh || hasSample) {
    const userId = req.session && req.session.user ? req.session.user.id : null;
    const auditDetails = JSON.stringify({
      doctype_id: id,
      before: {
        autofill_floor:        existing.autofill_floor        ?? null,
        high_confidence:       existing.high_confidence       ?? null,
        tested_with_sample_id: existing.tested_with_sample_id ?? null,
      },
      after: {
        autofill_floor:        updated.autofill_floor        ?? null,
        high_confidence:       updated.high_confidence       ?? null,
        tested_with_sample_id: updated.tested_with_sample_id ?? null,
      },
      user_id: userId,
      ts: new Date().toISOString(),
    });
    try {
      db.prepare(
        `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
         VALUES (?, 'DOCTYPE_THRESHOLDS_UPDATED', 'document_type_schemas', ?, ?, ?)`,
      ).run(userId, id, auditDetails, tenant);
    } catch (_auditErr) {
      // Non-fatal: the PATCH already succeeded; don't roll it back on log failure.
      console.error('[document-types] audit_log insert failed:', _auditErr.message);
    }
  }

  res.json(hydrate(updated));
});

// ---------- test-thresholds (read-only; view perm) ------------------------
//
// Proxies POST /api/v1/document-types/{id}/test-thresholds to the Python
// service. X-API-Key is injected server-side by pyCall() and is never
// exposed to the browser (contract §8 security non-negotiable).
//
// Required body:  { sample_id: <positive integer> }
// Returns the Python response body unchanged.
// Session-authenticated. Requires the 'view' permission (maps to doctype:read).

router.post('/document-types/:id/test-thresholds', requirePermJson('view'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const body = req.body ?? {};
  const sampleIdInt = parseInt(body.sample_id, 10);
  if (!Number.isFinite(sampleIdInt) || sampleIdInt <= 0) {
    return res.status(400).json({ error: 'invalid_sample_id' });
  }

  // Tenant-scoped guard: confirm the doctype belongs to this tenant before
  // proxying, to prevent cross-tenant information disclosure.
  const tenant = tenantScope(req);
  const existing = db.prepare(
    'SELECT id FROM document_type_schemas WHERE id = ? AND tenant_id = ?',
  ).get(id, tenant);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  try {
    const result = await pyCall(
      `/api/v1/document-types/${id}/test-thresholds`,
      { method: 'POST', body: { sample_id: sampleIdInt } },
    );
    res.json(result);
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json(err.data ?? { error: 'proxy_error' });
  }
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

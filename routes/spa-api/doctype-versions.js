/**
 * DocTypes v2 — schema versioning, bbox labels, and A/B extraction endpoints.
 *
 * Migration 0032 adds:
 *   doctype_versions(id, doctype_id, version, schema_json, created_by, created_at, status)
 *   doctype_field_bbox(id, doctype_version_id, field_name, page, x, y, w, h, source)
 *
 * Endpoints (all mounted at /spa/api/):
 *   GET    /document-types/:id/versions                 — version list
 *   POST   /document-types/:id/versions                 — create draft version
 *   GET    /document-types/:id/versions/:vid            — single version
 *   POST   /document-types/:id/versions/:vid/publish    — promote draft → live
 *   POST   /document-types/:id/versions/:vid/rollback   — re-activate archived version
 *   GET    /document-types/:id/versions/:vid/diff       — diff two versions (query ?compare=<vid>)
 *   GET    /document-types/:id/versions/:vid/bbox       — list bbox annotations
 *   POST   /document-types/:id/versions/:vid/bbox       — save bbox annotation
 *   DELETE /document-types/:id/versions/:vid/bbox/:bid  — delete bbox annotation
 *   POST   /document-types/:id/ab-test                  — A/B extraction comparison
 *
 * RBAC: admin perm required for all writes; view perm sufficient for reads.
 * Audit: publish + rollback write a row to audit_log.
 */
const express = require('express');
const db = require('../../db');
const { requirePermJson, pyCall, tenantScope } = require('./_shared');
const { buildPolicyDecision } = require('../../services/audit-policy');

const router = express.Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function getDoctype(id, tenant) {
  return db.prepare(
    'SELECT * FROM document_type_schemas WHERE id = ? AND tenant_id = ?',
  ).get(id, tenant);
}

function getVersion(doctypeId, versionId) {
  return db.prepare(
    'SELECT * FROM doctype_versions WHERE id = ? AND doctype_id = ?',
  ).get(versionId, doctypeId);
}

function writeAudit({ userId, action, entity, entityId, details, tenantId, policyDecision = null }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id, policy_decision)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      action,
      entity,
      entityId,
      typeof details === 'string' ? details : JSON.stringify(details),
      tenantId || 'nbe',
      policyDecision !== null ? JSON.stringify(policyDecision) : null,
    );
  } catch (_) { /* non-fatal */ }
}

// ── GET /document-types/:id/versions ─────────────────────────────────────────

router.get('/document-types/:id/versions', requirePermJson('view'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tenant = tenantScope(req);
  if (!getDoctype(id, tenant)) return res.status(404).json({ error: 'not_found' });

  const rows = db.prepare(
    `SELECT id, doctype_id, version, created_by, created_at, status
       FROM doctype_versions
      WHERE doctype_id = ?
      ORDER BY version DESC`,
  ).all(id);

  res.json(rows);
});

// ── POST /document-types/:id/versions — create draft ─────────────────────────

router.post('/document-types/:id/versions', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tenant = tenantScope(req);
  const doctype = getDoctype(id, tenant);
  if (!doctype) return res.status(404).json({ error: 'not_found' });

  const { schema_json } = req.body ?? {};
  const rawSchema = typeof schema_json === 'string'
    ? schema_json
    : JSON.stringify(schema_json ?? []);

  const maxVersion = db.prepare(
    'SELECT MAX(version) as mv FROM doctype_versions WHERE doctype_id = ?',
  ).get(id)?.mv ?? 0;

  const createdBy = req.session?.user?.username ?? null;

  const info = db.prepare(
    `INSERT INTO doctype_versions (doctype_id, version, schema_json, created_by, status)
     VALUES (?, ?, ?, ?, 'draft')`,
  ).run(id, maxVersion + 1, rawSchema, createdBy);

  res.status(201).json(
    db.prepare('SELECT * FROM doctype_versions WHERE id = ?').get(info.lastInsertRowid),
  );
});

// ── GET /document-types/:id/versions/:vid ────────────────────────────────────

router.get('/document-types/:id/versions/:vid', requirePermJson('view'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const vid = parseInt(req.params.vid, 10);
  const tenant = tenantScope(req);
  if (!getDoctype(id, tenant)) return res.status(404).json({ error: 'not_found' });

  const row = getVersion(id, vid);
  if (!row) return res.status(404).json({ error: 'version_not_found' });
  res.json(row);
});

// ── POST /document-types/:id/versions/:vid/publish ───────────────────────────

router.post('/document-types/:id/versions/:vid/publish', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const vid = parseInt(req.params.vid, 10);
  const tenant = tenantScope(req);
  const doctype = getDoctype(id, tenant);
  if (!doctype) return res.status(404).json({ error: 'not_found' });

  const target = getVersion(id, vid);
  if (!target) return res.status(404).json({ error: 'version_not_found' });
  if (target.status === 'live') return res.status(409).json({ error: 'already_live' });

  // Validate reason (governance action).
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 20) {
    return res.status(400).json({ error: 'reason_too_short', min: 20 });
  }

  const userId = req.session?.user?.id ?? null;

  db.prepare(
    `UPDATE doctype_versions SET status = 'archived'
      WHERE doctype_id = ? AND status = 'live'`,
  ).run(id);

  db.prepare(
    `UPDATE doctype_versions SET status = 'live' WHERE id = ?`,
  ).run(vid);

  // Mirror schema_json back into document_type_schemas.fields_json so the
  // existing capture / document-types list endpoints stay consistent.
  try {
    const schema = JSON.parse(target.schema_json);
    db.prepare(
      `UPDATE document_type_schemas SET fields_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(JSON.stringify(schema), id);
  } catch (_) { /* best-effort */ }

  writeAudit({
    userId,
    action:         'DOCTYPE_VERSION_PUBLISHED',
    entity:         'doctype_versions',
    entityId:       vid,
    details:        { doctype_id: id, version: target.version, reason },
    tenantId:       tenant,
    policyDecision: buildPolicyDecision(req),
  });

  res.json(db.prepare('SELECT * FROM doctype_versions WHERE id = ?').get(vid));
});

// ── POST /document-types/:id/versions/:vid/rollback ──────────────────────────

router.post('/document-types/:id/versions/:vid/rollback', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const vid = parseInt(req.params.vid, 10);
  const tenant = tenantScope(req);
  const doctype = getDoctype(id, tenant);
  if (!doctype) return res.status(404).json({ error: 'not_found' });

  const target = getVersion(id, vid);
  if (!target) return res.status(404).json({ error: 'version_not_found' });

  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 20) {
    return res.status(400).json({ error: 'reason_too_short', min: 20 });
  }

  const userId = req.session?.user?.id ?? null;

  // Archive the current live version.
  db.prepare(
    `UPDATE doctype_versions SET status = 'archived'
      WHERE doctype_id = ? AND status = 'live'`,
  ).run(id);

  // Set target to live.
  db.prepare(
    `UPDATE doctype_versions SET status = 'live' WHERE id = ?`,
  ).run(vid);

  // Mirror fields_json.
  try {
    const schema = JSON.parse(target.schema_json);
    db.prepare(
      `UPDATE document_type_schemas SET fields_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(JSON.stringify(schema), id);
  } catch (_) { /* best-effort */ }

  writeAudit({
    userId,
    action:         'DOCTYPE_VERSION_ROLLED_BACK',
    entity:         'doctype_versions',
    entityId:       vid,
    details:        { doctype_id: id, version: target.version, reason },
    tenantId:       tenant,
    policyDecision: buildPolicyDecision(req),
  });

  res.json(db.prepare('SELECT * FROM doctype_versions WHERE id = ?').get(vid));
});

// ── GET /document-types/:id/versions/:vid/diff ───────────────────────────────
// Query: ?compare=<other_vid>  (default: compare with live version)

router.get('/document-types/:id/versions/:vid/diff', requirePermJson('view'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const vid = parseInt(req.params.vid, 10);
  const tenant = tenantScope(req);
  if (!getDoctype(id, tenant)) return res.status(404).json({ error: 'not_found' });

  const a = getVersion(id, vid);
  if (!a) return res.status(404).json({ error: 'version_not_found' });

  // Determine comparison version.
  let b;
  const compareId = parseInt(req.query.compare ?? '', 10);
  if (Number.isFinite(compareId) && compareId > 0) {
    b = getVersion(id, compareId);
    if (!b) return res.status(404).json({ error: 'compare_version_not_found' });
  } else {
    // Default: compare against live version.
    b = db.prepare(
      `SELECT * FROM doctype_versions WHERE doctype_id = ? AND status = 'live'`,
    ).get(id);
    if (!b) return res.status(404).json({ error: 'no_live_version' });
  }

  let fieldsA = [];
  let fieldsB = [];
  try { fieldsA = JSON.parse(a.schema_json); } catch { /* empty */ }
  try { fieldsB = JSON.parse(b.schema_json); } catch { /* empty */ }

  const keysA = new Set(fieldsA.map((f) => f.key));
  const keysB = new Set(fieldsB.map((f) => f.key));

  const added = fieldsA.filter((f) => !keysB.has(f.key));
  const removed = fieldsB.filter((f) => !keysA.has(f.key));
  const modified = fieldsA.filter((f) => {
    if (!keysB.has(f.key)) return false;
    const bField = fieldsB.find((bf) => bf.key === f.key);
    return JSON.stringify(f) !== JSON.stringify(bField);
  });

  res.json({
    version_a: { id: a.id, version: a.version, status: a.status },
    version_b: { id: b.id, version: b.version, status: b.status },
    diff: { added, removed, modified },
  });
});

// ── GET /document-types/:id/versions/:vid/bbox ───────────────────────────────

router.get('/document-types/:id/versions/:vid/bbox', requirePermJson('view'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const vid = parseInt(req.params.vid, 10);
  const tenant = tenantScope(req);
  if (!getDoctype(id, tenant)) return res.status(404).json({ error: 'not_found' });
  if (!getVersion(id, vid)) return res.status(404).json({ error: 'version_not_found' });

  const rows = db.prepare(
    `SELECT id, field_name, page, x, y, w, h, source
       FROM doctype_field_bbox
      WHERE doctype_version_id = ?
      ORDER BY page ASC, field_name ASC`,
  ).all(vid);

  res.json(rows);
});

// ── POST /document-types/:id/versions/:vid/bbox ──────────────────────────────

router.post('/document-types/:id/versions/:vid/bbox', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const vid = parseInt(req.params.vid, 10);
  const tenant = tenantScope(req);
  if (!getDoctype(id, tenant)) return res.status(404).json({ error: 'not_found' });
  if (!getVersion(id, vid)) return res.status(404).json({ error: 'version_not_found' });

  const { field_name, page = 1, x, y, w, h, source = 'confirmed' } = req.body ?? {};

  if (typeof field_name !== 'string' || !field_name.trim()) {
    return res.status(400).json({ error: 'field_name_required' });
  }
  for (const [name, val] of [['x', x], ['y', y], ['w', w], ['h', h]]) {
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 1) {
      return res.status(400).json({ error: `invalid_${name}`, detail: 'must be number in [0,1]' });
    }
  }
  if (!['confirmed', 'ai_proposed'].includes(source)) {
    return res.status(400).json({ error: 'invalid_source' });
  }

  const info = db.prepare(
    `INSERT INTO doctype_field_bbox
       (doctype_version_id, field_name, page, x, y, w, h, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(vid, field_name.trim(), parseInt(page, 10) || 1, x, y, w, h, source);

  res.status(201).json(
    db.prepare('SELECT * FROM doctype_field_bbox WHERE id = ?').get(info.lastInsertRowid),
  );
});

// ── DELETE /document-types/:id/versions/:vid/bbox/:bid ───────────────────────

router.delete('/document-types/:id/versions/:vid/bbox/:bid', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const vid = parseInt(req.params.vid, 10);
  const bid = parseInt(req.params.bid, 10);
  const tenant = tenantScope(req);
  if (!getDoctype(id, tenant)) return res.status(404).json({ error: 'not_found' });

  const row = db.prepare(
    'SELECT id FROM doctype_field_bbox WHERE id = ? AND doctype_version_id = ?',
  ).get(bid, vid);
  if (!row) return res.status(404).json({ error: 'bbox_not_found' });

  db.prepare('DELETE FROM doctype_field_bbox WHERE id = ?').run(bid);
  res.json({ ok: true });
});

// ── POST /document-types/:id/ab-test ─────────────────────────────────────────
// Body: { sample_doc_ids: number[], version_a: number, version_b: number }
// Proxies extraction to Python for each version and returns side-by-side results.

router.post('/document-types/:id/ab-test', requirePermJson('admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tenant = tenantScope(req);
  if (!getDoctype(id, tenant)) return res.status(404).json({ error: 'not_found' });

  const { sample_doc_ids, version_a, version_b } = req.body ?? {};

  if (!Array.isArray(sample_doc_ids) || sample_doc_ids.length === 0) {
    return res.status(400).json({ error: 'sample_doc_ids_required' });
  }
  const versionARow = getVersion(id, parseInt(version_a, 10));
  const versionBRow = getVersion(id, parseInt(version_b, 10));
  if (!versionARow || !versionBRow) {
    return res.status(400).json({ error: 'invalid_version_ids' });
  }

  let schemaA, schemaB;
  try { schemaA = JSON.parse(versionARow.schema_json); } catch { schemaA = []; }
  try { schemaB = JSON.parse(versionBRow.schema_json); } catch { schemaB = []; }

  try {
    const result = await pyCall('/api/v1/docbrain/doctypes/ab-test', {
      method: 'POST',
      body: {
        doctype_id: id,
        sample_doc_ids: sample_doc_ids.map((x) => parseInt(x, 10)).filter((n) => n > 0),
        version_a: { version: versionARow.version, schema: schemaA },
        version_b: { version: versionBRow.version, schema: schemaB },
      },
      timeout: 300_000,
    });
    res.json(result);
  } catch (err) {
    // Python may not have this endpoint yet — return a structured stub so the
    // UI renders gracefully without blocking the versioning feature.
    if (err.status === 404 || err.status === 501) {
      return res.json({
        version_a: { version: versionARow.version, results: [] },
        version_b: { version: versionBRow.version, results: [] },
        note: 'ab_test_not_implemented_in_python_service',
      });
    }
    res.status(err.status || 502).json({ error: 'ab_test_failed', detail: err.message });
  }
});

module.exports = router;

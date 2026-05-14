'use strict';
/**
 * Regulator Reports — Node SPA-API surface (Wave C).
 *
 * All heavy lifting (query execution, PDF/CSV/JSON-LD rendering, RSA-PSS
 * signing) delegates to the Python service via pyCall. This layer provides:
 *   - Session auth + RBAC gating (regulator_reports:read / :admin)
 *   - Tenant scoping injected into the Python JWT claim via X-Tenant header
 *   - Direct SQLite CRUD for template metadata (avoids Python round-trip on
 *     list/create/update which do not need the Python DB)
 *   - Generate + Submit proxied to Python (heavy work, signing)
 *
 * Endpoints mounted at /spa/api/regulator-reports/*:
 *   GET    /reports/templates                   list templates
 *   POST   /reports/templates                   create template (admin)
 *   GET    /reports/templates/:id               get template
 *   PUT    /reports/templates/:id               update template (admin)
 *   GET    /reports/templates/:id/preflight     pre-flight checks (Python)
 *   POST   /reports/templates/:id/generate      generate report (Python)
 *   GET    /reports/submissions                 list submission receipts
 *   POST   /reports/submissions/:id/submit      stub submit to regulator (Python)
 *
 * RBAC:
 *   regulator_reports:read  → Doc Admin, auditor, compliance
 *   regulator_reports:admin → Doc Admin only
 */
const express = require('express');
const db = require('../../db');
const { requirePermJson, tenantScope, pyCall } = require('./_shared');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');

const router = express.Router();

const readPerm  = requirePermJson('regulator_reports:read');
const adminPerm = requirePermJson('regulator_reports:admin');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a SQLite row object (from better-sqlite3) to a plain JS object. */
function row(r) {
  if (!r) return null;
  return Object.assign({}, r);
}

/** Map DB rows to camelCase-friendly payload. */
function templatePayload(r) {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    regulator: r.regulator,
    name: r.name,
    parameters_schema_json: r.parameters_schema_json,
    query_template: r.query_template,
    output_template_path: r.output_template_path ?? null,
    format: r.format,
    is_active: r.is_active === 1 || r.is_active === true,
    schedule_cron: r.schedule_cron ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Template list
// ---------------------------------------------------------------------------
router.get('/reports/templates', readPerm, (req, res) => {
  const tenant  = tenantScope(req);
  const regulator = req.query.regulator ? String(req.query.regulator) : null;
  const activeOnly = req.query.active_only !== 'false';

  let sql = `SELECT id, tenant_id, regulator, name, parameters_schema_json,
    query_template, output_template_path, format, is_active, schedule_cron,
    created_at, updated_at
    FROM regulator_reports
    WHERE tenant_id = ?`;
  const params = [tenant];

  if (activeOnly) {
    sql += ' AND is_active = 1';
  }
  if (regulator) {
    sql += ' AND regulator = ?';
    params.push(regulator);
  }
  sql += ' ORDER BY regulator, name';

  try {
    const rows = db.prepare(sql).all(...params);
    return res.json({ templates: rows.map(templatePayload) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Create template
// ---------------------------------------------------------------------------
router.post('/reports/templates', adminPerm, (req, res) => {
  const tenant = tenantScope(req);
  const {
    regulator, name,
    parameters_schema_json = '{}',
    query_template = '',
    output_template_path = null,
    format = 'pdf',
    is_active = true,
    schedule_cron = null,
  } = req.body ?? {};

  if (!regulator || !name) {
    return res.status(400).json({ error: 'regulator and name are required' });
  }
  if (!['pdf', 'csv', 'jsonld'].includes(format)) {
    return res.status(400).json({ error: 'format must be pdf | csv | jsonld' });
  }

  try {
    JSON.parse(parameters_schema_json);
  } catch {
    return res.status(400).json({ error: 'parameters_schema_json must be valid JSON' });
  }

  try {
    const result = db.prepare(
      `INSERT INTO regulator_reports
         (tenant_id, regulator, name, parameters_schema_json, query_template,
          output_template_path, format, is_active, schedule_cron)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      tenant, regulator, name, parameters_schema_json,
      query_template, output_template_path, format,
      is_active ? 1 : 0, schedule_cron,
    );
    return res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Get template
// ---------------------------------------------------------------------------
router.get('/reports/templates/:id', readPerm, (req, res) => {
  const tenant = tenantScope(req);
  const id = parseInt(req.params['id'], 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  try {
    const r = db.prepare(
      `SELECT id, tenant_id, regulator, name, parameters_schema_json,
         query_template, output_template_path, format, is_active, schedule_cron,
         created_at, updated_at
       FROM regulator_reports WHERE id = ? AND tenant_id = ?`,
    ).get(id, tenant);
    if (!r) return res.status(404).json({ error: 'template not found' });
    return res.json(templatePayload(r));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Update template
// ---------------------------------------------------------------------------
router.put('/reports/templates/:id', adminPerm, (req, res) => {
  const tenant = tenantScope(req);
  const id = parseInt(req.params['id'], 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const {
    regulator, name,
    parameters_schema_json,
    query_template,
    output_template_path,
    format,
    is_active,
    schedule_cron,
  } = req.body ?? {};

  if (!regulator || !name) {
    return res.status(400).json({ error: 'regulator and name are required' });
  }
  if (format && !['pdf', 'csv', 'jsonld'].includes(format)) {
    return res.status(400).json({ error: 'format must be pdf | csv | jsonld' });
  }

  try {
    const result = db.prepare(
      `UPDATE regulator_reports SET
         regulator = ?, name = ?,
         parameters_schema_json = ?,
         query_template = ?,
         output_template_path = ?,
         format = ?,
         is_active = ?,
         schedule_cron = ?,
         updated_at = datetime('now')
       WHERE id = ? AND tenant_id = ?`,
    ).run(
      regulator, name,
      parameters_schema_json ?? '{}',
      query_template ?? '',
      output_template_path ?? null,
      format ?? 'pdf',
      is_active === false ? 0 : 1,
      schedule_cron ?? null,
      id, tenant,
    );
    if (result.changes === 0) return res.status(404).json({ error: 'template not found' });
    return res.json({ id, updated: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Pre-flight checks (Python heavy-lifting)
// ---------------------------------------------------------------------------
router.get('/reports/templates/:id/preflight', readPerm, async (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  try {
    const data = await pyCall(`/api/v1/regulator-reports/templates/${id}/preflight`);
    return res.json(data);
  } catch (err) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message, detail: err.data });
  }
});

// ---------------------------------------------------------------------------
// Generate report (Python heavy-lifting: SQL execution, render, sign)
// ---------------------------------------------------------------------------
router.post('/reports/templates/:id/generate', readPerm, async (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const { as_of_date, params = {}, format } = req.body ?? {};
  if (!as_of_date) return res.status(400).json({ error: 'as_of_date is required (ISO-8601 date)' });

  try {
    const data = await pyCall(
      `/api/v1/regulator-reports/templates/${id}/generate`,
      {
        method: 'POST',
        body: { as_of_date, params, format: format ?? 'pdf' },
        timeout: 120_000,
      },
    );

    // Plan 3 (Wave-E1) — emit regulator.report_export audit row with the
    // OPA policy_decision blob. This is the binding audit hook for the
    // "Export bundle" CTA on the RMA Quarterly detail page.
    //
    // Task #4 follow-up: detail.before / detail.after let DiffDrawer render
    // the audit-before-after section. Export is a pure-add (no prior receipt
    // existed for this generation call), so "before" is the empty receipt
    // and "after" is the freshly-signed bundle's identity + hash.
    writeAuditRow({
      userId:         req.session?.user?.id ?? null,
      action:         'regulator.report_export',
      entity:         'regulator_report_template',
      entityType:     'regulator_report_template',
      entityId:       String(id),
      detail: {
        as_of_date,
        format:       format ?? 'pdf',
        receipt_id:   data && data.receipt_id != null ? data.receipt_id : null,
        sha256:       data && data.sha256 ? data.sha256 : null,
        rows:         data && data.rows != null ? data.rows : null,
        params:       params || null,
        before: {
          receipt_id:    null,
          sha256:        null,
          rows:          null,
          generated_at:  null,
        },
        after: {
          receipt_id:    data && data.receipt_id != null ? data.receipt_id : null,
          sha256:        data && data.sha256 ? data.sha256 : null,
          rows:          data && data.rows != null ? data.rows : null,
          generated_at:  data && data.generated_at ? data.generated_at : new Date().toISOString(),
          format:        format ?? 'pdf',
        },
      },
      result:         'allow',
      tenantId:       tenantScope(req),
      policyDecision: buildPolicyDecision(req),
    });

    return res.json(data);
  } catch (err) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message, detail: err.data });
  }
});

// ---------------------------------------------------------------------------
// Submission list
// ---------------------------------------------------------------------------
router.get('/reports/submissions', readPerm, (req, res) => {
  const tenant    = tenantScope(req);
  const templateId = req.query.template_id ? parseInt(String(req.query.template_id), 10) : null;
  const limit     = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
  const offset    = parseInt(String(req.query.offset ?? '0'), 10);

  let sql = `SELECT sr.id, sr.report_template_id, rr.regulator, rr.name AS template_name,
      sr.generated_at, sr.generated_by, sr.sha256, sr.signature,
      sr.submitted_at, sr.regulator_endpoint, sr.response_code, sr.params_json
    FROM submission_receipts sr
    JOIN regulator_reports rr ON rr.id = sr.report_template_id
    WHERE sr.tenant_id = ?`;
  const params = [tenant];

  if (templateId !== null && Number.isFinite(templateId)) {
    sql += ' AND sr.report_template_id = ?';
    params.push(templateId);
  }
  sql += ' ORDER BY sr.generated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  try {
    const rows = db.prepare(sql).all(...params);
    return res.json({ submissions: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Stub submit to regulator (Python handles state update)
// ---------------------------------------------------------------------------
router.post('/reports/submissions/:id/submit', adminPerm, async (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  // Plan 3 (Wave-E1) Task #4 follow-up — capture the receipt row BEFORE the
  // submit call so the audit detail can carry a real diff. submission_receipts
  // is Node-side SQLite (created by 0039_regulator_reports.py mirrored into
  // db/schema.sql), so we can query it directly.
  const beforeRow = db.prepare(`
    SELECT id, submitted_at, regulator_endpoint, response_code
    FROM submission_receipts WHERE id = ?
  `).get(id) || null;

  try {
    const data = await pyCall(
      `/api/v1/regulator-reports/submissions/${id}/submit`,
      { method: 'POST', body: {} },
    );

    const afterRow = db.prepare(`
      SELECT id, submitted_at, regulator_endpoint, response_code
      FROM submission_receipts WHERE id = ?
    `).get(id) || null;

    // Plan 3 (Wave-E1) — emit regulator.report_submit audit row.
    writeAuditRow({
      userId:         req.session?.user?.id ?? null,
      action:         'regulator.report_submit',
      entity:         'submission_receipt',
      entityType:     'submission_receipt',
      entityId:       String(id),
      detail: {
        regulator_endpoint: data && data.regulator_endpoint ? data.regulator_endpoint : null,
        status:             data && data.status ? data.status : null,
        response_code:      data && data.response_code != null ? data.response_code : null,
        // Real before/after — the Node SQLite mirror of the receipt row.
        before: beforeRow
          ? {
              submitted_at:        beforeRow.submitted_at,
              regulator_endpoint:  beforeRow.regulator_endpoint,
              response_code:       beforeRow.response_code,
            }
          : { submitted_at: null, regulator_endpoint: null, response_code: null },
        after: afterRow
          ? {
              submitted_at:        afterRow.submitted_at,
              regulator_endpoint:  afterRow.regulator_endpoint,
              response_code:       afterRow.response_code,
            }
          : {
              // Fallback when the Node mirror hasn't been written yet — use
              // the upstream Python response so the diff drawer renders.
              submitted_at:        data && data.submitted_at ? data.submitted_at : new Date().toISOString(),
              regulator_endpoint:  data && data.regulator_endpoint ? data.regulator_endpoint : null,
              response_code:       data && data.response_code != null ? data.response_code : null,
            },
      },
      result:         'allow',
      tenantId:       tenantScope(req),
      policyDecision: buildPolicyDecision(req),
    });

    return res.json(data);
  } catch (err) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message, detail: err.data });
  }
});

module.exports = router;

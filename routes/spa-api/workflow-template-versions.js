'use strict';

/**
 * Workflow Template Versions + Business Calendars — spa-api router.
 *
 * Template versioning (Migration 0033):
 *   Each workflow template can have multiple immutable version snapshots.
 *   A version carries BPMN canvas JSON, DMN decision table JSON, per-stage
 *   SLA JSON, and an optional business calendar reference.
 *
 *   Old workflow instances (template_version_id IS NULL) continue reading
 *   stage order from workflow_templates.steps_json (legacy path).
 *   New instances pin to a wf_template_versions row and read from
 *   wf_template_versions.bpmn_json (version-pinned path).
 *
 * Endpoints
 * ─────────
 * GET    /spa/api/workflow-templates/:tid/versions          — list versions
 * POST   /spa/api/workflow-templates/:tid/versions          — create draft version
 * GET    /spa/api/workflow-templates/:tid/versions/:vid     — single version
 * PATCH  /spa/api/workflow-templates/:tid/versions/:vid     — update draft
 * POST   /spa/api/workflow-templates/:tid/versions/:vid/publish — publish version
 *
 * GET    /spa/api/business-calendars        — list calendars for tenant
 * POST   /spa/api/business-calendars        — create calendar
 * PATCH  /spa/api/business-calendars/:id    — update calendar
 *
 * RBAC: all routes require Doc Admin (requireNamespacePermJson('workflow_templates')).
 */

const express = require('express');
const db = require('../../db');
const { requireNamespacePermJson, tenantScope } = require('./_shared');
const { buildPolicyDecision } = require('../../services/audit-policy');

const router = express.Router();
const guard = requireNamespacePermJson('workflow_templates');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BPMN = JSON.stringify({ nodes: [], edges: [] });
const DEFAULT_DMN  = JSON.stringify({});
const DEFAULT_SLA  = JSON.stringify({});

/**
 * Parse a wf_template_versions row for JSON responses.
 */
function parseVersion(row) {
  if (!row) return null;
  return {
    id:          row.id,
    template_id: row.template_id,
    version:     row.version,
    bpmn_json:   safeJson(row.bpmn_json,   { nodes: [], edges: [] }),
    dmn_json:    safeJson(row.dmn_json,    {}),
    sla_json:    safeJson(row.sla_json,    {}),
    calendar_id: row.calendar_id ?? null,
    created_by:  row.created_by  ?? null,
    status:      row.status,
    created_at:  row.created_at,
  };
}

function safeJson(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

/**
 * Parse a business_calendars row for JSON responses.
 */
function parseCalendar(row) {
  if (!row) return null;
  return {
    id:                   row.id,
    tenant_id:            row.tenant_id,
    name:                 row.name,
    holidays_json:        safeJson(row.holidays_json,       []),
    business_hours_json:  safeJson(row.business_hours_json, {
      days: [1, 2, 3, 4, 5],
      start: '09:00',
      end: '17:00',
      tz: 'Asia/Thimphu',
    }),
    created_by:  row.created_by  ?? null,
    created_at:  row.created_at,
  };
}

/**
 * Require that a template exists and return it, scoped to the session tenant.
 * Returns null (and writes 404) if not found.
 */
function requireTemplate(res, tid) {
  const row = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(tid);
  if (!row) { res.status(404).json({ error: 'template_not_found' }); return null; }
  return row;
}

/**
 * Get the next version number for a template.
 */
function nextVersion(templateId) {
  const row = db.prepare(
    'SELECT MAX(version) AS max_v FROM wf_template_versions WHERE template_id = ?',
  ).get(templateId);
  return (row?.max_v ?? 0) + 1;
}

/**
 * Write an audit log row.
 */
function writeAudit({ userId, action, entityId, details, tenantId, policyDecision = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id, policy_decision)
     VALUES (?, ?, 'wf_template_version', ?, ?, ?, ?)`,
  ).run(
    userId,
    action,
    entityId ?? null,
    typeof details === 'string' ? details : JSON.stringify(details ?? null),
    tenantId || 'nbe',
    policyDecision !== null ? JSON.stringify(policyDecision) : null,
  );
}

// ---------------------------------------------------------------------------
// Validate BPMN JSON (lightweight — just ensures parseable object with
// nodes[] and edges[] arrays; deep node-shape validation is the SPA's job).
// ---------------------------------------------------------------------------
function validateBpmn(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'bpmn_must_be_object' };
  }
  if (!Array.isArray(value.nodes)) return { ok: false, error: 'bpmn_nodes_required' };
  if (!Array.isArray(value.edges)) return { ok: false, error: 'bpmn_edges_required' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// VERSION ROUTES
// ---------------------------------------------------------------------------

/**
 * GET /spa/api/workflow-templates/:tid/versions
 * List all versions for a template, newest first.
 */
router.get('/workflow-templates/:tid/versions', guard, (req, res) => {
  const tid = parseInt(req.params.tid, 10);
  if (!Number.isFinite(tid)) return res.status(400).json({ error: 'invalid_id' });
  if (!requireTemplate(res, tid)) return;

  const rows = db.prepare(
    `SELECT v.*, u.full_name AS created_by_name
     FROM wf_template_versions v
     LEFT JOIN users u ON u.id = v.created_by
     WHERE v.template_id = ?
     ORDER BY v.version DESC`,
  ).all(tid);

  res.json(rows.map(parseVersion));
});

/**
 * POST /spa/api/workflow-templates/:tid/versions
 * Create a new draft version. Optionally copy BPMN/DMN/SLA/calendar from
 * a previous version (body: { copy_from_version_id }).
 */
router.post('/workflow-templates/:tid/versions', guard, (req, res) => {
  const tid = parseInt(req.params.tid, 10);
  if (!Number.isFinite(tid)) return res.status(400).json({ error: 'invalid_id' });
  if (!requireTemplate(res, tid)) return;

  const body = req.body ?? {};
  const tenantId = tenantScope(req);

  // Optional: copy from an existing version.
  let bpmnJson = DEFAULT_BPMN;
  let dmnJson  = DEFAULT_DMN;
  let slaJson  = DEFAULT_SLA;
  let calendarId = null;

  if (body.copy_from_version_id != null) {
    const src = db.prepare(
      'SELECT * FROM wf_template_versions WHERE id = ? AND template_id = ?',
    ).get(parseInt(String(body.copy_from_version_id), 10), tid);
    if (!src) return res.status(404).json({ error: 'copy_source_not_found' });
    bpmnJson   = src.bpmn_json;
    dmnJson    = src.dmn_json;
    slaJson    = src.sla_json;
    calendarId = src.calendar_id;
  }

  const version = nextVersion(tid);
  const userId  = req.session.user?.id ?? null;

  const info = db.prepare(
    `INSERT INTO wf_template_versions
       (template_id, version, bpmn_json, dmn_json, sla_json, calendar_id, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
  ).run(tid, version, bpmnJson, dmnJson, slaJson, calendarId, userId);

  writeAudit({
    userId,
    action:         'WF_TEMPLATE_VERSION_CREATED',
    entityId:       info.lastInsertRowid,
    details:        { template_id: tid, version, copied_from: body.copy_from_version_id ?? null },
    tenantId,
    policyDecision: buildPolicyDecision(req),
  });

  const row = db.prepare('SELECT * FROM wf_template_versions WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json(parseVersion(row));
});

/**
 * GET /spa/api/workflow-templates/:tid/versions/:vid
 * Fetch a single version.
 */
router.get('/workflow-templates/:tid/versions/:vid', guard, (req, res) => {
  const tid = parseInt(req.params.tid, 10);
  const vid = parseInt(req.params.vid, 10);
  if (!Number.isFinite(tid) || !Number.isFinite(vid)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  const row = db.prepare(
    'SELECT * FROM wf_template_versions WHERE id = ? AND template_id = ?',
  ).get(vid, tid);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(parseVersion(row));
});

/**
 * PATCH /spa/api/workflow-templates/:tid/versions/:vid
 * Update a draft version. Published / archived versions are immutable.
 * Accepts: bpmn_json, dmn_json, sla_json, calendar_id.
 */
router.patch('/workflow-templates/:tid/versions/:vid', guard, (req, res) => {
  const tid = parseInt(req.params.tid, 10);
  const vid = parseInt(req.params.vid, 10);
  if (!Number.isFinite(tid) || !Number.isFinite(vid)) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const existing = db.prepare(
    'SELECT * FROM wf_template_versions WHERE id = ? AND template_id = ?',
  ).get(vid, tid);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.status !== 'draft') {
    return res.status(409).json({ error: 'version_not_editable', status: existing.status });
  }

  const body = req.body ?? {};
  const sets = [];
  const vals = [];

  if ('bpmn_json' in body) {
    const check = validateBpmn(body.bpmn_json);
    if (!check.ok) return res.status(400).json({ error: check.error });
    sets.push('bpmn_json = ?');
    vals.push(JSON.stringify(body.bpmn_json));
  }
  if ('dmn_json' in body) {
    if (typeof body.dmn_json !== 'object' || body.dmn_json === null) {
      return res.status(400).json({ error: 'dmn_json_must_be_object' });
    }
    sets.push('dmn_json = ?');
    vals.push(JSON.stringify(body.dmn_json));
  }
  if ('sla_json' in body) {
    if (typeof body.sla_json !== 'object' || body.sla_json === null) {
      return res.status(400).json({ error: 'sla_json_must_be_object' });
    }
    sets.push('sla_json = ?');
    vals.push(JSON.stringify(body.sla_json));
  }
  if ('calendar_id' in body) {
    const cid = body.calendar_id != null ? parseInt(String(body.calendar_id), 10) : null;
    if (cid !== null && !Number.isFinite(cid)) {
      return res.status(400).json({ error: 'invalid_calendar_id' });
    }
    if (cid !== null) {
      const cal = db.prepare('SELECT id FROM business_calendars WHERE id = ?').get(cid);
      if (!cal) return res.status(404).json({ error: 'calendar_not_found' });
    }
    sets.push('calendar_id = ?');
    vals.push(cid);
  }

  if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });
  vals.push(vid);

  db.prepare(`UPDATE wf_template_versions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  const updated = db.prepare('SELECT * FROM wf_template_versions WHERE id = ?').get(vid);
  res.json(parseVersion(updated));
});

/**
 * POST /spa/api/workflow-templates/:tid/versions/:vid/publish
 * Publish a draft version.
 *
 * Effects:
 *   1. Sets wf_template_versions.status = 'published'.
 *   2. Archives any previously published version for this template.
 *   3. Sets workflow_templates.active = 1 and current_version_id = vid.
 *   4. Syncs legacy steps_json from BPMN nodes so the list view still works.
 *
 * Body: { reason } — must be ≥ 20 characters (audit requirement).
 */
router.post('/workflow-templates/:tid/versions/:vid/publish', guard, (req, res) => {
  const tid = parseInt(req.params.tid, 10);
  const vid = parseInt(req.params.vid, 10);
  if (!Number.isFinite(tid) || !Number.isFinite(vid)) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const body = req.body ?? {};
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 20) {
    return res.status(400).json({ error: 'reason_too_short', min_length: 20 });
  }

  const version = db.prepare(
    'SELECT * FROM wf_template_versions WHERE id = ? AND template_id = ?',
  ).get(vid, tid);
  if (!version) return res.status(404).json({ error: 'not_found' });
  if (version.status === 'published') {
    return res.status(409).json({ error: 'already_published' });
  }
  if (version.status === 'archived') {
    return res.status(409).json({ error: 'cannot_publish_archived' });
  }

  const template = requireTemplate(res, tid);
  if (!template) return;

  const tenantId = tenantScope(req);
  const userId   = req.session.user?.id ?? null;

  // Derive legacy steps_json from BPMN nodes so the existing list endpoint
  // (and existing Playwright tests) continue to work unchanged.
  const bpmn = safeJson(version.bpmn_json, { nodes: [], edges: [] });
  const legacySteps = (bpmn.nodes ?? [])
    .filter((n) => n.type === 'stage' || n.type === 'edd-case')
    .map((n, i) => ({ id: i + 1, name: String(n.label ?? ''), role: String(n.role ?? 'Maker') }));

  db.transaction(() => {
    // Archive previously published versions.
    db.prepare(
      `UPDATE wf_template_versions SET status = 'archived'
       WHERE template_id = ? AND status = 'published' AND id != ?`,
    ).run(tid, vid);

    // Publish this version.
    db.prepare(
      `UPDATE wf_template_versions SET status = 'published' WHERE id = ?`,
    ).run(vid);

    // Sync the parent template row — activate + point to current version.
    // Also sync steps_json so the legacy list endpoint stays correct.
    db.prepare(
      `UPDATE workflow_templates
       SET active = 1, current_version_id = ?,
           steps_json = CASE WHEN ? != '[]' THEN ? ELSE steps_json END
       WHERE id = ?`,
    ).run(vid, JSON.stringify(legacySteps), JSON.stringify(legacySteps), tid);

    writeAudit({
      userId,
      action:         'WF_TEMPLATE_VERSION_PUBLISHED',
      entityId:       vid,
      details:        { template_id: tid, version: version.version, reason },
      tenantId,
      policyDecision: buildPolicyDecision(req),
    });
  })();

  const updated = db.prepare('SELECT * FROM wf_template_versions WHERE id = ?').get(vid);
  res.json({ ok: true, version: parseVersion(updated) });
});

// ---------------------------------------------------------------------------
// BUSINESS CALENDAR ROUTES
// ---------------------------------------------------------------------------

/**
 * GET /spa/api/business-calendars
 * List all calendars for the session tenant.
 */
router.get('/business-calendars', guard, (req, res) => {
  const tenantId = tenantScope(req);
  const rows = db.prepare(
    'SELECT * FROM business_calendars WHERE tenant_id = ? ORDER BY created_at DESC',
  ).all(tenantId);
  res.json(rows.map(parseCalendar));
});

/**
 * POST /spa/api/business-calendars
 * Create a calendar.
 * Body: { name, holidays_json?, business_hours_json? }
 */
router.post('/business-calendars', guard, (req, res) => {
  const body = req.body ?? {};
  const tenantId = tenantScope(req);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name_required' });
  if (name.length > 200) return res.status(400).json({ error: 'name_too_long' });

  const holidaysJson = body.holidays_json != null
    ? JSON.stringify(body.holidays_json)
    : '[]';

  const defaultHours = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', tz: 'Asia/Thimphu' };
  const hoursJson = body.business_hours_json != null
    ? JSON.stringify(body.business_hours_json)
    : JSON.stringify(defaultHours);

  const userId = req.session.user?.id ?? null;
  const info = db.prepare(
    `INSERT INTO business_calendars
       (tenant_id, name, holidays_json, business_hours_json, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(tenantId, name, holidaysJson, hoursJson, userId);

  writeAudit({
    userId,
    action:         'BUSINESS_CALENDAR_CREATED',
    entityId:       info.lastInsertRowid,
    details:        { name, tenant_id: tenantId },
    tenantId,
    policyDecision: buildPolicyDecision(req),
  });

  const row = db.prepare('SELECT * FROM business_calendars WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json(parseCalendar(row));
});

/**
 * PATCH /spa/api/business-calendars/:id
 * Update a calendar. Accepts: name, holidays_json, business_hours_json.
 */
router.patch('/business-calendars/:id', guard, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  const tenantId = tenantScope(req);

  const existing = db.prepare(
    'SELECT * FROM business_calendars WHERE id = ? AND tenant_id = ?',
  ).get(id, tenantId);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body ?? {};
  const sets = [];
  const vals = [];

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return res.status(400).json({ error: 'name_required' });
    if (name.length > 200) return res.status(400).json({ error: 'name_too_long' });
    sets.push('name = ?'); vals.push(name);
  }
  if ('holidays_json' in body) {
    if (!Array.isArray(body.holidays_json)) {
      return res.status(400).json({ error: 'holidays_json_must_be_array' });
    }
    sets.push('holidays_json = ?'); vals.push(JSON.stringify(body.holidays_json));
  }
  if ('business_hours_json' in body) {
    if (typeof body.business_hours_json !== 'object' || body.business_hours_json === null) {
      return res.status(400).json({ error: 'business_hours_json_must_be_object' });
    }
    sets.push('business_hours_json = ?'); vals.push(JSON.stringify(body.business_hours_json));
  }

  if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });
  vals.push(id);

  db.prepare(`UPDATE business_calendars SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  writeAudit({
    userId:         req.session.user?.id ?? null,
    action:         'BUSINESS_CALENDAR_UPDATED',
    entityId:       id,
    details:        { updated_fields: Object.keys(body).filter((k) => k !== 'id') },
    tenantId,
    policyDecision: buildPolicyDecision(req),
  });

  const updated = db.prepare('SELECT * FROM business_calendars WHERE id = ?').get(id);
  res.json(parseCalendar(updated));
});

module.exports = router;

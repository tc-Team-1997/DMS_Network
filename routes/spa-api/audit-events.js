'use strict';

/**
 * SPA-emitted audit events router (Wave E1, Task 3).
 *
 * Endpoint:
 *   POST /spa/api/audit/events
 *
 * Allows the SPA to record client-side actions (PII reveal, document preview,
 * export requests) into the audit_log hash chain without leaking server-side
 * credentials. An allow-list enforces which action keys the browser may emit.
 *
 * RBAC: any authenticated session may post (gated by requireAuthJson upstream
 *       in spa-api.js; no additional namespace perm required because the events
 *       are initiated by the user themselves, not administrative mutations).
 *
 * Audit: every successful POST is itself an audit row via writeAuditRow with
 *        policy_decision populated.
 */

const express = require('express');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');
const { requireAuthJson, tenantScope } = require('./_shared');

const router = express.Router();

// ---------------------------------------------------------------------------
// Allow-list: SPA may only emit these action keys. Everything else is rejected
// with 400 so the server owns the canonical action vocabulary.
// ---------------------------------------------------------------------------
const SPA_AUDIT_ACTIONS = new Set([
  'pii_reveal',
  'pii_mask',
  'document.preview_open',
  'export.csv_requested',
  'export.pdf_requested',
  // Plan 3 (Wave-E1) — DSAR Console actions emitted by routes/spa-api/dsar.js.
  'dsar.lookup',
  'dsar.fulfill',
  'dsar.release_hold',
  // Plan 3 (Wave-E1) — RMA Quarterly Compliance Report actions emitted by
  // routes/spa-api/regulator-reports.js (POST /generate and /submit).
  'regulator.report_export',
  'regulator.report_submit',
]);

// ---------------------------------------------------------------------------
// Body validation (manual — zod is not installed on the Node service).
// ---------------------------------------------------------------------------

/**
 * Validate the POST /audit/events request body.
 *
 * @param {unknown} body
 * @returns {{ ok: true, data: object } | { ok: false, issues: object[] }}
 */
function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, issues: [{ path: [], message: 'body must be an object' }] };
  }

  const issues = [];

  const { action, entity_type, entity_id, detail } = body;

  if (typeof action !== 'string' || action.length < 1 || action.length > 64) {
    issues.push({ path: ['action'], message: 'action must be a non-empty string (max 64 chars)' });
  }

  if (entity_type !== undefined && entity_type !== null) {
    if (typeof entity_type !== 'string' || entity_type.length < 1 || entity_type.length > 64) {
      issues.push({ path: ['entity_type'], message: 'entity_type must be a string (1-64 chars) or null' });
    }
  }

  if (entity_id !== undefined && entity_id !== null) {
    if (typeof entity_id !== 'string' || entity_id.length < 1 || entity_id.length > 128) {
      issues.push({ path: ['entity_id'], message: 'entity_id must be a string (1-128 chars) or null' });
    }
  }

  if (detail !== undefined && detail !== null) {
    if (typeof detail !== 'object' || Array.isArray(detail)) {
      issues.push({ path: ['detail'], message: 'detail must be a plain object or null' });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    data: {
      action: String(action).trim(),
      entity_type: entity_type != null ? String(entity_type).trim() : null,
      entity_id: entity_id != null ? String(entity_id).trim() : null,
      detail: detail != null ? detail : null,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /spa/api/audit/events
// ---------------------------------------------------------------------------
router.post('/audit/events', requireAuthJson, (req, res) => {
  const validation = validateBody(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: 'invalid_body', issues: validation.issues });
  }

  const { action, entity_type, entity_id, detail } = validation.data;

  if (!SPA_AUDIT_ACTIONS.has(action)) {
    return res.status(400).json({
      error: 'action_not_allowed_from_spa',
      action,
    });
  }

  const user = req.session.user;

  writeAuditRow({
    userId:         user.id,
    action,
    entity:         null,
    entityType:     entity_type,
    entityId:       entity_id,
    detail,
    tenantId:       tenantScope(req),
    policyDecision: buildPolicyDecision(req, { opaAllow: true }),
  });

  res.json({ ok: true });
});

module.exports = router;

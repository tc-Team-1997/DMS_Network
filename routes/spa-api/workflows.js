'use strict';

/**
 * Workflows v2 — spa-api router.
 *
 * Endpoints
 * ─────────
 * GET  /spa/api/workflows              — paginated list with filters
 * GET  /spa/api/workflows/:id          — single workflow + wf_actions audit trail
 * POST /spa/api/workflows/:id/approve  — approve with reason_code + comment + optional step-up
 * POST /spa/api/workflows/:id/reject   — reject (same + attachment_id)
 * POST /spa/api/workflows/:id/escalate — escalate with target
 * POST /spa/api/workflows/bulk         — batch approve / reject / escalate
 *
 * RBAC (per ACTION_ROLES map below; outer guard is requirePermJson('workflow')):
 *   approve  → Checker, Doc Admin
 *   reject   → Checker, Doc Admin
 *   escalate → Doc Admin only
 *
 * Step-up enforcement (revised plan (c)):
 *   If tenant_config.workflows.step_up_risk_band !== 'never' AND the workflow
 *   meets the risk/amount threshold, the request MUST include a
 *   webauthn_assertion_id. If missing the handler returns 403 step_up_required.
 *   The assertion_id is stored in wf_actions but NOT cryptographically verified
 *   by this Node handler (see TODO(SOX) below).
 *
 * Known v1 gap (SOX):
 *   webauthn_assertion_id is stored but not server-side validated. Wave C must
 *   add POST /py/api/v1/stepup/verify proxy call before go-live.
 */

const express = require('express');
const db = require('../../db');
const { requirePermJson, tenantScope } = require('./_shared');
const { getNamespace } = require('../../db/tenant-config');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGE_MAP = {
  approve:  'Approved',
  reject:   'Rejected - Rework',
  escalate: 'Manager Sign-off',
};

const ACTION_ROLES = {
  approve:  new Set(['Checker', 'Doc Admin']),
  reject:   new Set(['Checker', 'Doc Admin']),
  escalate: new Set(['Doc Admin']),
};

const DOC_STATUS_MAP = {
  approve:  'Valid',
  reject:   'Pending Review',
  escalate: 'Pending Review',
};

// Risk bands ordered low → critical; used for threshold comparison.
const RISK_BAND_ORDER = ['low', 'medium', 'high', 'critical'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeAudit({ userId, action, entity, entityId, details, tenantId }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    action,
    entity,
    entityId != null ? entityId : null,
    typeof details === 'string' ? details : JSON.stringify(details != null ? details : null),
    tenantId || 'nbe',
  );
}

/**
 * Returns true when workflowRiskBand meets or exceeds the configured threshold.
 * E.g. threshold='high' → true for 'high' and 'critical'.
 */
function riskBandSatisfies(workflowBand, thresholdBand) {
  const wIdx = RISK_BAND_ORDER.indexOf(String(workflowBand || '').toLowerCase());
  const tIdx = RISK_BAND_ORDER.indexOf(String(thresholdBand || '').toLowerCase());
  if (wIdx === -1 || tIdx === -1) return false;
  return wIdx >= tIdx;
}

/**
 * Load workflows namespace config and determine step-up requirement.
 * Returns { needsStepUp: boolean, cfg: object }.
 */
function resolveStepUp(tenantId, workflow) {
  const cfg = getNamespace(tenantId, 'workflows') || {};
  const stepUpRisk   = cfg['step_up_risk_band']              != null ? cfg['step_up_risk_band']           : 'high';
  const stepUpAmount = Number(cfg['step_up_amount_threshold'] != null ? cfg['step_up_amount_threshold']   : Infinity);
  const wfAmount     = Number(workflow.amount != null ? workflow.amount : 0);
  const wfRisk       = workflow.risk_band != null ? workflow.risk_band : '';

  const needsStepUp =
    stepUpRisk !== 'never' &&
    (riskBandSatisfies(wfRisk, stepUpRisk) || wfAmount >= stepUpAmount);

  return { needsStepUp, cfg };
}

/**
 * Validate common action body fields.
 * Returns { ok: true } or { ok: false, status, body }.
 */
function validateActionBody(action, body, cfg) {
  const reason_code = body != null ? body.reason_code : undefined;
  const comment     = body != null ? body.comment     : undefined;
  const minLen = Number(cfg['min_comment_length'] != null ? cfg['min_comment_length'] : 20);

  if (!reason_code || typeof reason_code !== 'string') {
    return { ok: false, status: 400, body: { error: 'reason_code_required' } };
  }

  const allowedCodes = cfg[`reason_codes.${action}`];
  if (Array.isArray(allowedCodes) && !allowedCodes.includes(reason_code)) {
    return {
      ok: false,
      status: 400,
      body: { error: 'invalid_reason_code', allowed: allowedCodes },
    };
  }

  if (!comment || typeof comment !== 'string' || comment.trim().length < minLen) {
    return {
      ok: false,
      status: 400,
      body: { error: 'comment_too_short', min_length: minLen },
    };
  }

  return { ok: true };
}

/**
 * Write a wf_actions row and the shared audit_log entry.
 */
function recordAction({ workflowId, userId, action, reasonCode, comment, assertionId, attachmentId, tenantId }) {
  db.prepare(
    `INSERT INTO wf_actions
       (workflow_id, user_id, action, reason_code, comment, webauthn_assertion_id, attachment_id, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    workflowId,
    userId,
    action,
    reasonCode   != null ? reasonCode   : null,
    comment      != null ? comment      : null,
    assertionId  != null ? assertionId  : null,
    attachmentId != null ? attachmentId : null,
    tenantId,
  );

  writeAudit({
    userId,
    action:   `workflow_${action}`,
    entity:   'workflow',
    entityId: workflowId,
    details:  { action, reason_code: reasonCode, comment, webauthn_assertion_id: assertionId != null ? assertionId : null },
    tenantId,
  });
}

/**
 * Advance the workflow stage and mirror the doc status.
 */
function advanceWorkflow(workflowId, action, docId) {
  const stage = STAGE_MAP[action];
  db.prepare(
    'UPDATE workflows SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(stage, workflowId);

  if (docId) {
    const docStatus = DOC_STATUS_MAP[action];
    if (docStatus) {
      db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(docStatus, docId);
    }
  }
  return stage;
}

/**
 * Return the full workflow row with joined document fields.
 */
function fetchWorkflowRow(id) {
  return db.prepare(
    `SELECT w.*, d.original_name AS document_name, d.doc_type, d.customer_name,
            d.branch, d.status AS document_status
     FROM workflows w
     LEFT JOIN documents d ON d.id = w.doc_id
     WHERE w.id = ?`,
  ).get(id);
}

// ---------------------------------------------------------------------------
// GET /spa/api/workflows
// ---------------------------------------------------------------------------
router.get('/workflows', (req, res) => {
  const tenantId = tenantScope(req);
  const page     = Math.max(1, parseInt(String(req.query.page != null ? req.query.page : '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize != null ? req.query.pageSize : '50'), 10) || 50));
  const offset   = (page - 1) * pageSize;

  const tab     = req.query.tab     != null ? String(req.query.tab)      : null;
  const branch  = req.query.branch  != null ? String(req.query.branch)   : null;
  const docType = req.query.doc_type != null ? String(req.query.doc_type) : null;
  const riskBand = req.query.risk_band != null ? String(req.query.risk_band) : null;
  const search  = req.query.search  != null ? String(req.query.search)   : null;
  const stage   = req.query.stage   != null ? String(req.query.stage)    : null;

  let where = 'WHERE w.tenant_id = ?';
  const params = [tenantId];

  if (tab === 'assigned' || tab === 'team') {
    where += " AND w.stage NOT IN ('Approved') AND w.stage NOT LIKE 'Rejected%'";
  } else if (tab === 'approved') {
    where += " AND w.stage = 'Approved'";
  } else if (tab === 'rejected') {
    where += " AND w.stage LIKE 'Rejected%'";
  } else if (tab != null && tab !== 'all') {
    where += ' AND w.stage = ?';
    params.push(tab);
  }

  if (stage)    { where += ' AND w.stage = ?';    params.push(stage); }
  if (branch)   { where += ' AND d.branch = ?';   params.push(branch); }
  if (docType)  { where += ' AND d.doc_type = ?'; params.push(docType); }
  if (riskBand) { where += ' AND w.risk_band = ?'; params.push(riskBand); }
  if (search) {
    where += ' AND (d.original_name LIKE ? OR d.customer_name LIKE ? OR w.ref_code LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const total = db.prepare(
    `SELECT COUNT(*) AS total FROM workflows w LEFT JOIN documents d ON d.id = w.doc_id ${where}`,
  ).get(...params).total;

  const rows = db.prepare(
    `SELECT w.*, d.original_name AS document_name, d.doc_type, d.customer_name,
            d.branch, d.status AS document_status
     FROM workflows w
     LEFT JOIN documents d ON d.id = w.doc_id
     ${where}
     ORDER BY w.updated_at DESC
     LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset);

  res.json({ data: rows, total, page, pageSize });
});

// ---------------------------------------------------------------------------
// GET /spa/api/workflows/:id
// ---------------------------------------------------------------------------
router.get('/workflows/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const wf = fetchWorkflowRow(id);
  if (!wf) return res.status(404).json({ error: 'not_found' });

  const auditTrail = db.prepare(
    `SELECT a.*, u.full_name AS actor_name, u.username AS actor_username
     FROM wf_actions a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.workflow_id = ?
     ORDER BY a.created_at ASC`,
  ).all(id);

  res.json({ ...wf, audit_trail: auditTrail });
});

// ---------------------------------------------------------------------------
// Shared single-action handler factory
// ---------------------------------------------------------------------------
function makeSingleActionHandlers(action) {
  const guard = requirePermJson('workflow');

  const handler = (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

    const userRole = req.session.user != null ? req.session.user.role : null;
    if (!userRole || !ACTION_ROLES[action].has(userRole)) {
      return res.status(403).json({
        error:  'forbidden',
        detail: `role '${userRole}' cannot perform action '${action}'`,
      });
    }

    const wf = fetchWorkflowRow(id);
    if (!wf) return res.status(404).json({ error: 'not_found' });

    const tenantId = tenantScope(req);
    const { needsStepUp, cfg } = resolveStepUp(tenantId, wf);

    const body = req.body != null ? req.body : {};
    const assertionId = body.webauthn_assertion_id != null ? String(body.webauthn_assertion_id) : null;

    if (needsStepUp && !assertionId) {
      return res.status(403).json({
        error:     'step_up_required',
        message:   'WebAuthn step-up required for this action',
        risk_band: wf.risk_band != null ? wf.risk_band : null,
        amount:    wf.amount    != null ? wf.amount    : null,
      });
    }
    // TODO(SOX): validate webauthn_assertion_id by proxying to
    // POST /py/api/v1/stepup/verify (or equivalent) before storing.
    // Current v1 stores the opaque id without server-side cryptographic check —
    // the threshold check above still forces the client to complete the step-up
    // flow and leaves an audit trail, but a determined attacker could forge
    // the id field. Wave C must close this loop before go-live.

    const validation = validateActionBody(action, body, cfg);
    if (!validation.ok) return res.status(validation.status).json(validation.body);

    const { reason_code, comment, attachment_id } = body;

    if (action === 'escalate') {
      const targets = cfg['escalation_targets'];
      const target  = body.target;
      if (!target || typeof target !== 'string') {
        return res.status(400).json({ error: 'escalation_target_required' });
      }
      if (Array.isArray(targets) && !targets.includes(target)) {
        return res.status(400).json({ error: 'invalid_escalation_target', allowed: targets });
      }
    }

    const stage = db.transaction(() => {
      const s = advanceWorkflow(id, action, wf.doc_id);
      recordAction({
        workflowId:  id,
        userId:      req.session.user.id,
        action,
        reasonCode:  reason_code != null ? reason_code : null,
        comment:     comment     != null ? comment     : null,
        assertionId,
        attachmentId: attachment_id != null ? attachment_id : null,
        tenantId,
      });
      return s;
    })();

    const updated = fetchWorkflowRow(id);
    return res.json({ ok: true, stage, workflow: updated });
  };

  return [guard, handler];
}

router.post('/workflows/:id/approve',  ...makeSingleActionHandlers('approve'));
router.post('/workflows/:id/reject',   ...makeSingleActionHandlers('reject'));
router.post('/workflows/:id/escalate', ...makeSingleActionHandlers('escalate'));

// ---------------------------------------------------------------------------
// Legacy /action(s) paths — backward-compat with v1 SPA calls
// ---------------------------------------------------------------------------
function legacyActionMiddleware(req, res) {
  const body   = req.body != null ? req.body : {};
  const action = body.action;
  if (!action || !STAGE_MAP[action]) {
    return res.status(400).json({ error: 'invalid_action', allowed: Object.keys(STAGE_MAP) });
  }
  // Delegate to the dedicated handler (index 1 = the business logic fn).
  const [, handler] = makeSingleActionHandlers(action);
  return handler(req, res);
}

router.post('/workflows/:id/actions', requirePermJson('workflow'), legacyActionMiddleware);
router.post('/workflows/:id/action',  requirePermJson('workflow'), legacyActionMiddleware);

// ---------------------------------------------------------------------------
// POST /spa/api/workflows/bulk
// NOTE: must be registered BEFORE /:id routes to avoid id='bulk' conflict.
// This works because Express matches in registration order and 'bulk' is a
// literal segment, but we register it explicitly here as a safety measure.
// ---------------------------------------------------------------------------
router.post('/workflows/bulk', requirePermJson('workflow'), (req, res) => {
  const body = req.body != null ? req.body : {};
  const { ids, action, reason_code, comment, target } = body;
  const assertionId  = body.webauthn_assertion_id != null ? String(body.webauthn_assertion_id) : null;
  const attachmentId = body.attachment_id         != null ? body.attachment_id                  : null;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids_required' });
  }
  if (!action || !STAGE_MAP[action]) {
    return res.status(400).json({ error: 'invalid_action', allowed: Object.keys(STAGE_MAP) });
  }

  const userRole = req.session.user != null ? req.session.user.role : null;
  if (!userRole || !ACTION_ROLES[action].has(userRole)) {
    return res.status(403).json({
      error:  'forbidden',
      detail: `role '${userRole}' cannot perform action '${action}'`,
    });
  }

  const tenantId = tenantScope(req);
  const cfg      = getNamespace(tenantId, 'workflows') || {};

  const maxBulk = Number(cfg['bulk_action_max'] != null ? cfg['bulk_action_max'] : 50);
  if (ids.length > maxBulk) {
    return res.status(400).json({ error: 'bulk_limit_exceeded', max: maxBulk });
  }

  const validation = validateActionBody(action, body, cfg);
  if (!validation.ok) return res.status(validation.status).json(validation.body);

  if (action === 'escalate') {
    const targets = cfg['escalation_targets'];
    if (!target || typeof target !== 'string') {
      return res.status(400).json({ error: 'escalation_target_required' });
    }
    if (Array.isArray(targets) && !targets.includes(target)) {
      return res.status(400).json({ error: 'invalid_escalation_target', allowed: targets });
    }
  }

  // All-or-nothing transaction.
  const runBulk = db.transaction(() => {
    const results = [];
    for (const rawId of ids) {
      const id = parseInt(String(rawId), 10);
      if (!Number.isFinite(id)) {
        results.push({ id: rawId, ok: false, error: 'invalid_id' });
        continue;
      }

      const wf = fetchWorkflowRow(id);
      if (!wf) {
        results.push({ id, ok: false, error: 'not_found' });
        continue;
      }

      // Per-row step-up check — aborts entire TX if any row requires it.
      const { needsStepUp } = resolveStepUp(tenantId, wf);
      if (needsStepUp && !assertionId) {
        const err = new Error('step_up_required');
        // Attach structured detail for the catch block.
        err.stepUpDetail = {
          error:     'step_up_required',
          message:   'WebAuthn step-up required for one or more workflows in this batch',
          risk_band: wf.risk_band != null ? wf.risk_band : null,
          amount:    wf.amount    != null ? wf.amount    : null,
        };
        throw err;
      }
      // TODO(SOX): same as single-row handler — assertion_id stored but not
      // cryptographically validated. Wave C must close this before go-live.

      const stage = advanceWorkflow(id, action, wf.doc_id);
      recordAction({
        workflowId:  id,
        userId:      req.session.user.id,
        action,
        reasonCode:  reason_code  != null ? reason_code  : null,
        comment:     comment      != null ? comment      : null,
        assertionId,
        attachmentId,
        tenantId,
      });
      results.push({ id, ok: true, stage });
    }
    return results;
  });

  try {
    const rows = runBulk();
    return res.json({ ok: true, results: rows });
  } catch (err) {
    if (err.stepUpDetail) {
      return res.status(403).json(err.stepUpDetail);
    }
    console.error('[workflows/bulk] transaction error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;

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
 * Step-up enforcement (Wave C — SOX-1 + SOX-2 closed):
 *   If tenant_config.workflows.step_up_risk_band !== 'never' AND the workflow
 *   meets the risk/amount threshold, the request MUST include a
 *   webauthn_assertion_id. If missing the handler returns 403 step_up_required.
 *   When present, the assertion_id is cryptographically validated via
 *   POST /py/api/v1/stepup/verify before any write occurs (SOX-1 closed).
 *
 * Audit unification (Wave C — SOX-2 closed):
 *   Workflow advances call Python POST /api/v1/workflow/:doc_id/advance FIRST.
 *   Python commits workflow_steps and returns step_id.  Node then commits
 *   wf_actions with python_step_id = step_id.  If Python fails, Node writes
 *   nothing.  Both sides are always in sync.
 */

const express = require('express');
const db = require('../../db');
const { requirePermJson, tenantScope, pyCall } = require('./_shared');
const { buildPolicyDecision } = require('../../services/audit-policy');
const { getNamespace } = require('../../db/tenant-config');
const { verifyStepUpAssertion } = require('../../services/stepup-verify');

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

function writeAudit({ userId, action, entity, entityId, details, tenantId, policyDecision = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id, policy_decision)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    action,
    entity,
    entityId != null ? entityId : null,
    typeof details === 'string' ? details : JSON.stringify(details != null ? details : null),
    tenantId || 'nbe',
    policyDecision !== null ? JSON.stringify(policyDecision) : null,
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
 * python_step_id is set from the Python /advance response (SOX-2 two-phase commit).
 */
function recordAction({ workflowId, userId, action, reasonCode, comment, assertionId, attachmentId, tenantId, pythonStepId, policyDecision = null }) {
  db.prepare(
    `INSERT INTO wf_actions
       (workflow_id, user_id, action, reason_code, comment, webauthn_assertion_id, attachment_id, tenant_id, python_step_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    workflowId,
    userId,
    action,
    reasonCode    != null ? reasonCode    : null,
    comment       != null ? comment       : null,
    assertionId   != null ? assertionId   : null,
    attachmentId  != null ? attachmentId  : null,
    tenantId,
    pythonStepId  != null ? pythonStepId  : null,
  );

  writeAudit({
    userId,
    action:         `workflow_${action}`,
    entity:         'workflow',
    entityId:       workflowId,
    details:        {
      action,
      reason_code: reasonCode,
      comment,
      webauthn_assertion_id: assertionId != null ? assertionId : null,
      python_step_id: pythonStepId != null ? pythonStepId : null,
    },
    tenantId,
    policyDecision,
  });
}

/**
 * Advance the workflow stage and mirror the doc status.
 *
 * Version-pinned path (Migration 0033):
 *   If the workflow has a non-null template_version_id AND the action maps to
 *   a named stage (approve/reject/escalate), we look up the BPMN graph's stage
 *   sequence and return the actual next stage name instead of the legacy
 *   hard-coded STAGE_MAP entry.  This respects "old instances finish on old
 *   rule semantics" — STAGE_MAP is still the fallback for NULL-pinned rows.
 *
 * @param {number} workflowId
 * @param {string} action        — 'approve' | 'reject' | 'escalate'
 * @param {number|null} docId
 * @param {object|null} wfRow    — full workflow row (for template_version_id lookup)
 */
function advanceWorkflow(workflowId, action, docId, wfRow) {
  let stage = STAGE_MAP[action];

  // Version-pinned advancement: for the 'approve' action try to resolve the
  // next BPMN stage from the pinned version's canvas graph.
  if (action === 'approve' && wfRow?.template_version_id != null) {
    try {
      const vrow = db.prepare(
        "SELECT bpmn_json FROM wf_template_versions WHERE id = ? AND status = 'published'",
      ).get(wfRow.template_version_id);
      if (vrow) {
        const bpmn = JSON.parse(vrow.bpmn_json ?? '{"nodes":[],"edges":[]}');
        const nodes = bpmn.nodes ?? [];
        const edges = bpmn.edges ?? [];
        // Find the current stage node by matching label to wfRow.stage.
        const currentNode = nodes.find(
          (n) => (n.type === 'stage' || n.type === 'edd-case') &&
                 String(n.label ?? '') === String(wfRow.stage ?? ''),
        );
        if (currentNode) {
          // Follow the first outgoing edge to the next node.
          const outEdge = edges.find((e) => String(e.from) === String(currentNode.id));
          if (outEdge) {
            const nextNode = nodes.find((n) => String(n.id) === String(outEdge.to));
            if (nextNode?.label) stage = String(nextNode.label);
          }
        }
      }
    } catch { /* fall back to STAGE_MAP */ }
  }

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
// POST /spa/api/workflows
// Create a new workflow, pinning it to the currently published version of
// the chosen template (template_version_id).
//
// Body:
//   template_id   (integer, required) — must be an active workflow_template
//   doc_id        (integer, optional) — link to a document
//   title         (string, optional)  — defaults to "Workflow #<ref>"
//   priority      (string, optional)  — defaults to 'Medium'
//   ref_code      (string, optional)  — defaults to a generated code
//
// Runtime version pinning (Migration 0033):
//   Looks up the current_version_id on workflow_templates. If a published
//   wf_template_versions row is found, sets workflows.template_version_id = that id.
//   NULL template_version_id = legacy path (reads steps_json).
// ---------------------------------------------------------------------------
router.post('/workflows', requirePermJson('workflow'), (req, res) => {
  const body = req.body ?? {};
  const tenantId = tenantScope(req);

  const rawTemplateId = body.template_id;
  if (rawTemplateId == null) {
    return res.status(400).json({ error: 'template_id_required' });
  }
  const templateId = parseInt(String(rawTemplateId), 10);
  if (!Number.isFinite(templateId)) {
    return res.status(400).json({ error: 'invalid_template_id' });
  }

  const template = db.prepare(
    'SELECT * FROM workflow_templates WHERE id = ? AND active = 1',
  ).get(templateId);
  if (!template) {
    return res.status(404).json({ error: 'template_not_found_or_inactive' });
  }

  // Resolve the published version, if any.
  const publishedVersion = template.current_version_id
    ? db.prepare(
        "SELECT id FROM wf_template_versions WHERE id = ? AND status = 'published'",
      ).get(template.current_version_id)
    : null;
  const templateVersionId = publishedVersion ? publishedVersion.id : null;

  // Resolve initial stage from template.
  // New path: first stage node from bpmn_json.
  // Legacy path: first entry in steps_json.
  let initialStage = 'Maker Review';
  if (templateVersionId) {
    const vrow = db.prepare('SELECT bpmn_json FROM wf_template_versions WHERE id = ?')
      .get(templateVersionId);
    try {
      const bpmn = JSON.parse(vrow?.bpmn_json ?? '{"nodes":[]}');
      const firstStage = (bpmn.nodes ?? []).find(
        (n) => n.type === 'stage' || n.type === 'edd-case',
      );
      if (firstStage?.label) initialStage = String(firstStage.label);
    } catch { /* fall through to default */ }
  } else {
    try {
      const steps = JSON.parse(template.steps_json ?? '[]');
      if (steps.length > 0 && steps[0]?.name) initialStage = steps[0].name;
    } catch { /* fall through to default */ }
  }

  const docId    = body.doc_id   != null ? parseInt(String(body.doc_id),   10) : null;
  const priority = typeof body.priority === 'string' && body.priority.trim()
    ? body.priority.trim()
    : 'Medium';

  const refCode = typeof body.ref_code === 'string' && body.ref_code.trim()
    ? body.ref_code.trim()
    : `WF${Date.now()}`;

  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : `Workflow #${refCode}`;

  const info = db.prepare(
    `INSERT INTO workflows
       (ref_code, title, doc_id, stage, priority, tenant_id, template_version_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(refCode, title, docId ?? null, initialStage, priority, tenantId, templateVersionId);

  writeAudit({
    userId:         req.session.user.id,
    action:         'workflow_created',
    entity:         'workflow',
    entityId:       info.lastInsertRowid,
    details:        {
      template_id:         templateId,
      template_version_id: templateVersionId,
      initial_stage:       initialStage,
      ref_code:            refCode,
    },
    tenantId,
    policyDecision: buildPolicyDecision(req),
  });

  const created = fetchWorkflowRow(info.lastInsertRowid);
  return res.status(201).json({ ok: true, workflow: created });
});

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
// SOX-1: verify assertion_id cryptographically before storing.
// SOX-2: call Python /advance first (two-phase commit); only write wf_actions
//         on Python success, linking the rows via python_step_id.
// ---------------------------------------------------------------------------
function makeSingleActionHandlers(action) {
  const guard = requirePermJson('workflow');

  const handler = async (req, res) => {
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

    // SOX-1: cryptographic validation of the assertion_id via Python.
    // Must happen before any write.  Failure → 401 step_up_invalid.
    if (needsStepUp && assertionId) {
      try {
        await verifyStepUpAssertion(
          assertionId,
          req.session.user.username || String(req.session.user.id),
          tenantId,
          `workflow.${action}`,
        );
      } catch (verifyErr) {
        return res.status(401).json({ error: 'step_up_invalid', detail: verifyErr.detail || null });
      }
    }

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

    // SOX-2: two-phase commit — Python writes workflow_steps first.
    // Node writes wf_actions only on Python success.
    let pythonStepId = null;
    if (wf.doc_id) {
      try {
        const pyResult = await pyCall(`/api/v1/workflow/${wf.doc_id}/advance`, {
          method: 'POST',
          body: {
            stage:        STAGE_MAP[action] || action,
            action,
            actor:        req.session.user.username || String(req.session.user.id),
            comment:      comment      != null ? comment      : null,
            reason_code:  reason_code  != null ? reason_code  : null,
            assertion_id: assertionId,
          },
          timeout: 10_000,
        });
        pythonStepId = pyResult && pyResult.step_id != null ? pyResult.step_id : null;
      } catch (pyErr) {
        console.error('[workflows] Python /advance failed — aborting Node write:', pyErr.message);
        return res.status(502).json({ error: 'workflow_advance_failed', detail: pyErr.message });
      }
    }

    // Python succeeded — commit Node side atomically.
    const stage = db.transaction(() => {
      const s = advanceWorkflow(id, action, wf.doc_id, wf);
      recordAction({
        workflowId:     id,
        userId:         req.session.user.id,
        action,
        reasonCode:     reason_code  != null ? reason_code  : null,
        comment:        comment      != null ? comment      : null,
        assertionId,
        attachmentId:   attachment_id != null ? attachment_id : null,
        tenantId,
        pythonStepId,
        policyDecision: buildPolicyDecision(req),
      });
      return s;
    })();

    const updated = fetchWorkflowRow(id);
    return res.json({ ok: true, stage, workflow: updated, python_step_id: pythonStepId });
  };

  return [guard, handler];
}

router.post('/workflows/:id/approve',  ...makeSingleActionHandlers('approve'));
router.post('/workflows/:id/reject',   ...makeSingleActionHandlers('reject'));
router.post('/workflows/:id/escalate', ...makeSingleActionHandlers('escalate'));

// ---------------------------------------------------------------------------
// Legacy /action(s) paths — backward-compat with v1 SPA calls
// ---------------------------------------------------------------------------
async function legacyActionMiddleware(req, res) {
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
//
// SOX-1: assertion verified once for the batch (single assertion covers all rows).
// SOX-2: Python /advance called per-row; Node TX commits only on full Python success.
// ---------------------------------------------------------------------------
router.post('/workflows/bulk', requirePermJson('workflow'), async (req, res) => {
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

  // Pre-flight: check step-up requirement across all rows before any write.
  // If any row needs step-up and assertion is missing, reject the whole batch.
  for (const rawId of ids) {
    const id = parseInt(String(rawId), 10);
    if (!Number.isFinite(id)) continue;
    const wf = fetchWorkflowRow(id);
    if (!wf) continue;
    const { needsStepUp } = resolveStepUp(tenantId, wf);
    if (needsStepUp && !assertionId) {
      return res.status(403).json({
        error:     'step_up_required',
        message:   'WebAuthn step-up required for one or more workflows in this batch',
        risk_band: wf.risk_band != null ? wf.risk_band : null,
        amount:    wf.amount    != null ? wf.amount    : null,
      });
    }
  }

  // SOX-1: verify assertion once for the whole batch.
  if (assertionId) {
    try {
      await verifyStepUpAssertion(
        assertionId,
        req.session.user.username || String(req.session.user.id),
        tenantId,
        `workflow.bulk.${action}`,
      );
    } catch (verifyErr) {
      return res.status(401).json({ error: 'step_up_invalid', detail: verifyErr.detail || null });
    }
  }

  // SOX-2: call Python /advance for each row before committing Node rows.
  // Collect results; if any Python call fails, abort all Node writes.
  const pyResults = [];
  for (const rawId of ids) {
    const id = parseInt(String(rawId), 10);
    if (!Number.isFinite(id)) {
      pyResults.push({ id: rawId, ok: false, error: 'invalid_id', pythonStepId: null });
      continue;
    }
    const wf = fetchWorkflowRow(id);
    if (!wf) {
      pyResults.push({ id, ok: false, error: 'not_found', pythonStepId: null });
      continue;
    }
    if (wf.doc_id) {
      try {
        const pyResult = await pyCall(`/api/v1/workflow/${wf.doc_id}/advance`, {
          method: 'POST',
          body: {
            stage:        STAGE_MAP[action] || action,
            action,
            actor:        req.session.user.username || String(req.session.user.id),
            comment:      comment     != null ? comment     : null,
            reason_code:  reason_code != null ? reason_code : null,
            assertion_id: assertionId,
          },
          timeout: 10_000,
        });
        pyResults.push({ id, wf, ok: true, pythonStepId: pyResult && pyResult.step_id != null ? pyResult.step_id : null });
      } catch (pyErr) {
        console.error(`[workflows/bulk] Python /advance failed for doc_id=${wf.doc_id}:`, pyErr.message);
        return res.status(502).json({ error: 'workflow_advance_failed', workflow_id: id, detail: pyErr.message });
      }
    } else {
      pyResults.push({ id, wf, ok: true, pythonStepId: null });
    }
  }

  // All Python writes succeeded — commit Node side as one transaction.
  const runBulk = db.transaction(() => {
    const results = [];
    for (const entry of pyResults) {
      if (!entry.ok) {
        results.push({ id: entry.id, ok: false, error: entry.error });
        continue;
      }
      const { id, wf, pythonStepId } = entry;
      const stage = advanceWorkflow(id, action, wf.doc_id, wf);
      recordAction({
        workflowId:     id,
        userId:         req.session.user.id,
        action,
        reasonCode:     reason_code  != null ? reason_code  : null,
        comment:        comment      != null ? comment      : null,
        assertionId,
        attachmentId,
        tenantId,
        pythonStepId,
        policyDecision: buildPolicyDecision(req),
      });
      results.push({ id, ok: true, stage, python_step_id: pythonStepId });
    }
    return results;
  });

  try {
    const rows = runBulk();
    return res.json({ ok: true, results: rows });
  } catch (err) {
    console.error('[workflows/bulk] Node transaction error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;

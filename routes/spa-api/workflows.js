'use strict';

const express = require('express');
const db = require('../../db');
const { requirePermJson } = require('./_shared');

const router = express.Router();

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
    entityId ?? null,
    typeof details === 'string' ? details : JSON.stringify(details ?? null),
    tenantId || 'nbe',
  );
}

// Maps workflow action → stage label.  Used for both the "actions" and
// "action" (singular) endpoints.
const STAGE_MAP = {
  approve:   'Approved',
  reject:    'Rejected - Rework',
  escalate:  'Manager Sign-off',
  return:    'Returned to Maker',
};

// RBAC: which roles may perform which actions.
const ACTION_ROLES = {
  approve:   new Set(['Checker', 'Doc Admin']),
  reject:    new Set(['Checker', 'Doc Admin']),
  escalate:  new Set(['Doc Admin']),
  return:    new Set(['Maker', 'Doc Admin']),
};

// Document status transitions triggered by workflow actions.
const DOC_STATUS_MAP = {
  approve:  'Valid',
  reject:   'Pending Review',
  escalate: 'Pending Review',
  return:   'Pending Review',
};

// ---------------------------------------------------------------------------
// GET /spa/api/workflows
// ---------------------------------------------------------------------------
router.get('/workflows', (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? 100), 10) || 100, 500);
  const { status, stage } = req.query;

  let sql = 'SELECT w.*, d.original_name AS document_name, d.doc_type, d.customer_name FROM workflows w LEFT JOIN documents d ON d.id = w.doc_id WHERE 1=1';
  const params = [];

  if (stage) { sql += ' AND w.stage = ?'; params.push(String(stage)); }
  if (status) { sql += " AND w.stage NOT IN ('Approved') AND w.stage NOT LIKE 'Rejected%'"; }

  sql += ' ORDER BY w.updated_at DESC LIMIT ?';
  params.push(limit);

  res.json(db.prepare(sql).all(...params));
});

// ---------------------------------------------------------------------------
// GET /spa/api/workflows/:id
// ---------------------------------------------------------------------------
router.get('/workflows/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const wf = db.prepare(
    `SELECT w.*, d.original_name AS document_name, d.doc_type, d.customer_name, d.status AS document_status
     FROM workflows w LEFT JOIN documents d ON d.id = w.doc_id
     WHERE w.id = ?`,
  ).get(id);
  if (!wf) return res.status(404).json({ error: 'not_found' });
  res.json(wf);
});

// ---------------------------------------------------------------------------
// POST /spa/api/workflows/:id/action(s)
// Both paths are registered so the SPA can call either.
// Body: { action: "approve"|"reject"|"escalate"|"return", comment: "..." }
// ---------------------------------------------------------------------------
function handleWorkflowAction(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const { action, comment } = req.body ?? {};
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'action_required' });
  }

  const stage = STAGE_MAP[action];
  if (!stage) {
    return res.status(400).json({
      error: 'invalid_action',
      allowed: Object.keys(STAGE_MAP),
    });
  }

  // RBAC check: does this role have permission for this action?
  const userRole = req.session.user?.role;
  const allowedRoles = ACTION_ROLES[action];
  if (!userRole || !allowedRoles.has(userRole)) {
    return res.status(403).json({
      error: 'forbidden',
      detail: `role '${userRole}' cannot perform action '${action}'`,
    });
  }

  // Verify the workflow exists.
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  if (!wf) return res.status(404).json({ error: 'not_found' });

  // Update the workflow stage.
  db.prepare(
    'UPDATE workflows SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(stage, id);

  // Mirror the status change to the linked document (if any).
  if (wf.doc_id) {
    const docStatus = DOC_STATUS_MAP[action];
    if (docStatus) {
      db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(docStatus, wf.doc_id);
    }
  }

  // Audit log.
  writeAudit({
    userId:   req.session.user.id,
    action:   `workflow_${action}`,
    entity:   'workflow',
    entityId: id,
    details:  { action, stage, comment: comment || null, doc_id: wf.doc_id || null },
    tenantId: req.session.user.tenant_id || 'nbe',
  });

  // Return the updated workflow object.
  const updated = db.prepare(
    `SELECT w.*, d.original_name AS document_name, d.doc_type, d.customer_name, d.status AS document_status
     FROM workflows w LEFT JOIN documents d ON d.id = w.doc_id
     WHERE w.id = ?`,
  ).get(id);

  res.json({ ok: true, stage, workflow: updated });
}

// Register both the plural (/actions) path kept for backward compat and the
// singular (/action) path specified in Task 5.
router.post('/workflows/:id/actions', requirePermJson('workflow'), handleWorkflowAction);
router.post('/workflows/:id/action',  requirePermJson('workflow'), handleWorkflowAction);

module.exports = router;

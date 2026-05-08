/**
 * Compliance posture dashboard. Aggregates expiring documents, retention
 * buckets, workflow SLA signals, and recent audit activity.
 */
const express = require('express');
const db = require('../../db');
const { branchScope, tenantScope } = require('./_shared');

const router = express.Router();

router.get('/compliance/summary', (req, res) => {
  const tenant = tenantScope(req);
  const scope = branchScope(req.session.user);
  const clauses = ['tenant_id = ?'];
  const params = [tenant];
  if (scope) { clauses.push('branch = ?'); params.push(scope); }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const count = (extra) =>
    db.prepare(`SELECT COUNT(*) c FROM documents ${where} ${extra}`).get(...params).c;

  // Expiry pipeline (tenant + branch scoped).
  const expiry = {
    d30: count("AND expiry_date BETWEEN date('now') AND date('now','+30 days')"),
    d60: count("AND expiry_date BETWEEN date('now','+31 days') AND date('now','+60 days')"),
    d90: count("AND expiry_date BETWEEN date('now','+61 days') AND date('now','+90 days')"),
    overdue: count("AND expiry_date IS NOT NULL AND expiry_date < date('now')"),
  };

  // Retention policies vs documents with a doc_type.
  const retention = db.prepare(`
    SELECT rp.doc_type, rp.retention_years, rp.auto_purge,
           (SELECT COUNT(*) FROM documents d ${where} AND d.doc_type = rp.doc_type) AS doc_count
    FROM retention_policies rp
    ORDER BY rp.retention_years DESC
  `).all(...params);

  // Workflow SLA — pending over 3 days = late.
  const workflowSla = db.prepare(`
    SELECT
      SUM(CASE WHEN stage NOT LIKE 'Approved%' AND stage NOT LIKE 'Rejected%'
               AND julianday('now') - julianday(updated_at) >  3 THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN stage NOT LIKE 'Approved%' AND stage NOT LIKE 'Rejected%'
               AND julianday('now') - julianday(updated_at) <= 3 THEN 1 ELSE 0 END) AS on_track,
      SUM(CASE WHEN stage LIKE 'Approved%' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN stage LIKE 'Rejected%' THEN 1 ELSE 0 END) AS rejected
    FROM workflows WHERE tenant_id = ?
  `).get(tenant);

  // Recent audit actions for the tenant.
  const audit = db.prepare(`
    SELECT a.id, a.action, a.entity, a.entity_id, a.created_at, u.username
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.tenant_id = ? OR a.tenant_id IS NULL
    ORDER BY a.created_at DESC LIMIT 15
  `).all(tenant);

  res.json({ expiry, retention, workflow_sla: workflowSla, audit });
});

module.exports = router;

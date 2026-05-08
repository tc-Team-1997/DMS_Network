/**
 * Workflow Templates CRUD. Templates define a named sequence of stages
 * (e.g. KYC Standard, Loan Fast-track) with an owning role per stage.
 * Workflows on the runtime side copy the stage list at start time.
 */
const express = require('express');
const db = require('../../db');
const { requirePermJson } = require('./_shared');

const router = express.Router();

const STAGES_MAX = 20;

function parseTemplate(row) {
  if (!row) return null;
  let steps = [];
  try { steps = JSON.parse(row.steps_json ?? '[]'); } catch { steps = []; }
  return {
    id: row.id,
    name: row.name,
    doc_type: row.doc_type,
    active: row.active ? 1 : 0,
    steps,
    created_at: row.created_at,
  };
}

function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > STAGES_MAX) {
    return { ok: false, error: 'steps_invalid' };
  }
  const cleaned = [];
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    if (!s || typeof s !== 'object') return { ok: false, error: 'step_invalid' };
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    const role = typeof s.role === 'string' ? s.role.trim() : '';
    if (!name || !role) return { ok: false, error: 'step_missing_fields' };
    cleaned.push({ id: i + 1, name, role });
  }
  return { ok: true, steps: cleaned };
}

router.get('/workflow-templates', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, name, doc_type, steps_json, active, created_at FROM workflow_templates ORDER BY created_at DESC',
  ).all();
  res.json(rows.map(parseTemplate));
});

router.get('/workflow-templates/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare(
    'SELECT id, name, doc_type, steps_json, active, created_at FROM workflow_templates WHERE id = ?',
  ).get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(parseTemplate(row));
});

router.post('/workflow-templates', requirePermJson('admin'), (req, res) => {
  const { name, doc_type, steps } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name_required' });
  }
  const check = validateSteps(steps);
  if (!check.ok) return res.status(400).json({ error: check.error });

  const info = db.prepare(
    'INSERT INTO workflow_templates (name, doc_type, steps_json, active) VALUES (?, ?, ?, 1)',
  ).run(name.trim(), doc_type ?? null, JSON.stringify(check.steps));
  const row = db.prepare(
    'SELECT id, name, doc_type, steps_json, active, created_at FROM workflow_templates WHERE id = ?',
  ).get(info.lastInsertRowid);
  res.status(201).json(parseTemplate(row));
});

router.patch('/workflow-templates/:id', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body ?? {};
  const sets = [];
  const values = [];

  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?'); values.push(body.name.trim());
  }
  if ('doc_type' in body) {
    sets.push('doc_type = ?'); values.push(body.doc_type ?? null);
  }
  if ('active' in body) {
    sets.push('active = ?'); values.push(body.active ? 1 : 0);
  }
  if ('steps' in body) {
    const check = validateSteps(body.steps);
    if (!check.ok) return res.status(400).json({ error: check.error });
    sets.push('steps_json = ?'); values.push(JSON.stringify(check.steps));
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });
  values.push(id);

  db.prepare(`UPDATE workflow_templates SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id);
  res.json(parseTemplate(row));
});

router.post('/workflow-templates/:id/clone', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const src = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id);
  if (!src) return res.status(404).json({ error: 'not_found' });
  const info = db.prepare(
    'INSERT INTO workflow_templates (name, doc_type, steps_json, active) VALUES (?, ?, ?, 0)',
  ).run(`${src.name} (copy)`, src.doc_type, src.steps_json);
  const row = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(parseTemplate(row));
});

router.delete('/workflow-templates/:id', requirePermJson('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const info = db.prepare('DELETE FROM workflow_templates WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

module.exports = router;

const router = require('express').Router();
const db = require('../db');
const rbac = require('../services/rbac');

router.use(rbac.require('admin'));

router.get('/', (req, res) => {
  const templates = db.prepare('SELECT * FROM workflow_templates ORDER BY id DESC').all().map(t => ({
    ...t, steps: JSON.parse(t.steps_json)
  }));
  res.render('workflow-templates', { active: 'workflow', templates });
});

router.post('/', (req, res) => {
  const { name, doc_type, steps_json } = req.body;
  try { JSON.parse(steps_json); } catch(e) { return res.status(400).send('Invalid JSON: ' + e.message); }
  db.prepare('INSERT INTO workflow_templates (name, doc_type, steps_json) VALUES (?,?,?)').run(name, doc_type, steps_json);
  res.redirect('/workflow-templates');
});

router.post('/:id/toggle', (req, res) => {
  const t = db.prepare('SELECT active FROM workflow_templates WHERE id=?').get(req.params.id);
  db.prepare('UPDATE workflow_templates SET active=? WHERE id=?').run(t.active ? 0 : 1, req.params.id);
  res.redirect('/workflow-templates');
});

router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM workflow_templates WHERE id=?').run(req.params.id);
  res.redirect('/workflow-templates');
});

module.exports = router;

const router = require('express').Router();
const db = require('../db');
const rbac = require('../services/rbac');
const ws = require('../services/ws');

router.get('/', rbac.require('workflow'), (req, res) => {
  const flows = db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all();
  res.render('workflows', { active: 'workflow', flows });
});

router.post('/:id/action', (req, res) => {
  const { action } = req.body;
  const neededPerm = action === 'approve' || action === 'reject' ? action : 'workflow';
  if (!rbac.can(req.session.user.role, neededPerm)) {
    return res.status(403).render('forbidden', { active: 'workflow', perm: neededPerm });
  }
  const stageMap = {
    approve: 'Approved',
    reject: 'Rejected - Rework',
    escalate: 'Manager Sign-off'
  };
  const newStage = stageMap[action] || 'Maker Review';
  db.prepare("UPDATE workflows SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newStage, req.params.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, ?, ?, ?)')
    .run(req.session.user.id, action.toUpperCase(), 'workflow', req.params.id);
  ws.broadcast({ type: 'workflow-update', workflow_id: req.params.id, stage: newStage, by: req.session.user.username });
  res.redirect('/workflows');
});

module.exports = router;

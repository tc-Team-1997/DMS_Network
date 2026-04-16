const router = require('express').Router();
const db = require('../db');

router.get('/', (req, res) => {
  const byType = db.prepare("SELECT COALESCE(doc_type,'Unclassified') t, COUNT(*) c FROM documents GROUP BY doc_type").all();
  const byStatus = db.prepare('SELECT status, COUNT(*) c FROM documents GROUP BY status').all();
  const total = db.prepare('SELECT COUNT(*) c FROM documents').get().c;
  res.render('reports', { active: 'reports', byType, byStatus, total });
});

module.exports = router;

const router = require('express').Router();
const db = require('../db');

router.get('/', (req, res) => {
  const byType = db.prepare("SELECT COALESCE(doc_type,'Unclassified') t, COUNT(*) c FROM documents GROUP BY doc_type").all();
  const byBranch = db.prepare("SELECT COALESCE(branch,'Unassigned') b, COUNT(*) c FROM documents GROUP BY branch ORDER BY c DESC").all();
  const byStatus = db.prepare("SELECT status, COUNT(*) c FROM documents GROUP BY status").all();
  const byMonth = db.prepare("SELECT substr(uploaded_at,1,7) m, COUNT(*) c FROM documents GROUP BY m ORDER BY m DESC LIMIT 12").all().reverse();
  const workflowStages = db.prepare('SELECT stage, COUNT(*) c FROM workflows GROUP BY stage').all();
  const topUsers = db.prepare('SELECT u.username, COUNT(a.id) c FROM audit_log a JOIN users u ON a.user_id=u.id GROUP BY u.id ORDER BY c DESC LIMIT 5').all();
  const expiryBuckets = db.prepare(`SELECT
      SUM(CASE WHEN status='Expired' THEN 1 ELSE 0 END) expired,
      SUM(CASE WHEN status='Expiring' THEN 1 ELSE 0 END) expiring,
      SUM(CASE WHEN status='Valid' THEN 1 ELSE 0 END) valid
    FROM documents`).get();
  res.render('bi', { active: 'reports', byType, byBranch, byStatus, byMonth, workflowStages, topUsers, expiryBuckets });
});

router.get('/drill', (req, res) => {
  const { dim, value } = req.query;
  if (!dim || !['doc_type','branch','status','stage'].includes(dim)) return res.json([]);
  let rows;
  if (dim === 'stage') {
    rows = db.prepare('SELECT id, ref_code, title, stage, priority, updated_at FROM workflows WHERE stage=? LIMIT 100').all(value);
  } else {
    const col = dim;
    rows = db.prepare(`SELECT id, original_name, customer_name, doc_type, branch, status, expiry_date FROM documents WHERE ${col}=? LIMIT 100`).all(value);
  }
  res.json(rows);
});

module.exports = router;

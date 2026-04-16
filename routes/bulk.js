const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const rbac = require('../services/rbac');

router.post('/documents/bulk', (req, res) => {
  const { action, ids, folder_id, status } = req.body;
  const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(x => parseInt(x));
  if (idList.length === 0) return res.redirect('/documents');

  if (action === 'delete') {
    if (!rbac.can(req.session.user.role, 'delete')) return res.status(403).render('forbidden', { active: 'repository', perm: 'delete' });
    const docs = db.prepare(`SELECT * FROM documents WHERE id IN (${idList.map(()=>'?').join(',')})`).all(...idList);
    docs.forEach(d => {
      const fp = path.join(__dirname, '..', 'uploads', d.filename);
      if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch(e){}
    });
    db.prepare(`DELETE FROM documents WHERE id IN (${idList.map(()=>'?').join(',')})`).run(...idList);
  } else if (action === 'move' && folder_id) {
    db.prepare(`UPDATE documents SET folder_id=? WHERE id IN (${idList.map(()=>'?').join(',')})`).run(folder_id, ...idList);
  } else if (action === 'status' && status) {
    db.prepare(`UPDATE documents SET status=? WHERE id IN (${idList.map(()=>'?').join(',')})`).run(status, ...idList);
  }
  db.prepare('INSERT INTO audit_log (user_id, action, entity, details) VALUES (?,?,?,?)')
    .run(req.session.user.id, 'BULK_' + (action||'').toUpperCase(), 'document', `${idList.length} items`);
  res.redirect('/documents');
});

module.exports = router;

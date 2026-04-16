const router = require('express').Router();
const db = require('../db');

router.get('/', (req, res) => {
  const totalDocs = db.prepare('SELECT COUNT(*) c FROM documents').get().c;
  const expired = db.prepare("SELECT COUNT(*) c FROM documents WHERE status='Expired'").get().c;
  const expiring = db.prepare("SELECT COUNT(*) c FROM documents WHERE status='Expiring'").get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM workflows WHERE stage NOT IN ('Approved','Archived')").get().c;
  const alerts = db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT 4').all();
  const recentDocs = db.prepare('SELECT * FROM documents ORDER BY uploaded_at DESC LIMIT 5').all();
  res.render('dashboard', {
    active: 'dashboard',
    kpis: { totalDocs, expired, expiring, pending },
    alerts, recentDocs
  });
});

module.exports = router;

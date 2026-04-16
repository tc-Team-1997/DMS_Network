const router = require('express').Router();
const db = require('../db');

router.get('/', (req, res) => {
  const alerts = db.prepare('SELECT * FROM alerts ORDER BY id DESC').all();
  res.render('alerts', { active: 'alerts', alerts });
});

router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/alerts');
});

module.exports = router;

const router = require('express').Router();
const db = require('../db');

router.get('/', (req, res) => {
  res.render('portal-login', { active: 'portal', error: null, cid: '' });
});

router.post('/verify', (req, res) => {
  const { cid, doc_number } = req.body;
  const docs = db.prepare('SELECT * FROM documents WHERE customer_cid=? AND (doc_number=? OR ? = "")').all(cid, doc_number||'', doc_number||'');
  if (docs.length === 0) {
    return res.render('portal-login', { active: 'portal', error: 'No documents found for these credentials', cid });
  }
  req.session.portalCid = cid;
  res.redirect('/portal/my-documents');
});

router.get('/my-documents', (req, res) => {
  if (!req.session.portalCid) return res.redirect('/portal');
  const cid = req.session.portalCid;
  const docs = db.prepare('SELECT id, original_name, doc_type, doc_number, expiry_date, status, issue_date FROM documents WHERE customer_cid=?').all(cid);
  const customer = docs[0] ? db.prepare('SELECT customer_name FROM documents WHERE customer_cid=? LIMIT 1').get(cid) : null;
  res.render('portal-docs', { active: 'portal', docs, cid, customer });
});

router.post('/renewal-request/:id', (req, res) => {
  if (!req.session.portalCid) return res.redirect('/portal');
  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND customer_cid=?').get(req.params.id, req.session.portalCid);
  if (!doc) return res.status(404).send('Not found');
  const ref = 'R' + Date.now().toString().slice(-4);
  db.prepare('INSERT INTO workflows (ref_code, title, doc_id, stage, priority) VALUES (?,?,?,?,?)')
    .run(ref, `Renewal request: ${doc.original_name}`, doc.id, 'Maker Review', 'Medium');
  db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)')
    .run('info', `Customer renewal request: ${doc.customer_name}`, `Doc: ${doc.original_name} · ref ${ref}`);
  res.redirect('/portal/my-documents?requested=' + doc.id);
});

router.get('/logout', (req, res) => {
  delete req.session.portalCid;
  res.redirect('/portal');
});

module.exports = router;

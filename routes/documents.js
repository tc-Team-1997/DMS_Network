const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { runOcr } = require('../services/ocr');
const { notify } = require('../services/notify');
const rbac = require('../services/rbac');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const ts = Date.now();
    cb(null, `${ts}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/', (req, res) => {
  const folderId = req.query.folder ? parseInt(req.query.folder) : null;
  const folders = db.prepare('SELECT * FROM folders ORDER BY parent_id, name').all();
  const role = req.session.user.role;
  const userBranch = req.session.user.branch;
  const scope = (role === 'Viewer' || role === 'Maker') && userBranch;
  let sql = 'SELECT * FROM documents WHERE 1=1';
  const params = [];
  if (folderId) { sql += ' AND folder_id = ?'; params.push(folderId); }
  if (scope) { sql += ' AND branch = ?'; params.push(userBranch); }
  sql += ' ORDER BY uploaded_at DESC LIMIT 100';
  const docs = db.prepare(sql).all(...params);
  res.render('repository', { active: 'repository', folders, docs, folderId });
});

router.get('/capture', rbac.require('capture'), (req, res) => res.render('capture', { active: 'capture' }));
router.get('/indexing', rbac.require('index'), (req, res) => {
  const pending = db.prepare("SELECT * FROM documents WHERE doc_type IS NULL OR customer_cid IS NULL LIMIT 12").all();
  res.render('indexing', { active: 'indexing', pending });
});
router.get('/ai', (req, res) => {
  const queue = db.prepare('SELECT COUNT(*) c FROM documents WHERE ocr_confidence IS NULL').get().c;
  res.render('ai', { active: 'ai', queue });
});
router.get('/viewer/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).send('Not found');
  res.render('viewer', { active: 'viewer', doc });
});

router.post('/upload', rbac.require('upload'), upload.array('files', 20), (req, res) => {
  const { doc_type, customer_cid, customer_name, doc_number, dob, issue_date, expiry_date, issuing_authority, branch, folder_id, notes } = req.body;
  const stmt = db.prepare(
    `INSERT INTO documents (filename, original_name, doc_type, customer_cid, customer_name, doc_number,
       dob, issue_date, expiry_date, issuing_authority, branch, folder_id, size, mime_type,
       ocr_confidence, uploaded_by, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const today = new Date();
  const createdIds = [];
  (req.files || []).forEach(f => {
    let status = 'Valid';
    if (expiry_date) {
      const exp = new Date(expiry_date);
      const days = (exp - today) / (1000 * 60 * 60 * 24);
      if (days < 0) status = 'Expired';
      else if (days < 90) status = 'Expiring';
    }
    const info = stmt.run(f.filename, f.originalname, doc_type || null, customer_cid || null, customer_name || null,
      doc_number || null, dob || null, issue_date || null, expiry_date || null, issuing_authority || null,
      branch || null, folder_id || null, f.size, f.mimetype, null, req.session.user.id, notes || null, status);
    createdIds.push(info.lastInsertRowid);
  });
  createdIds.forEach(id => runOcr(id).catch(e => console.error('OCR fail', id, e.message)));
  notify(req.session.user.id, 'in-app', 'Upload complete', `${createdIds.length} document(s) queued for OCR`);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, details) VALUES (?, ?, ?, ?)')
    .run(req.session.user.id, 'UPLOAD', 'document', `${req.files.length} file(s)`);
  res.redirect('/documents');
});

router.post('/:id/index', rbac.require('index'), (req, res) => {
  const { doc_type, customer_cid, customer_name, doc_number, dob, issue_date, expiry_date, issuing_authority, branch, notes } = req.body;
  db.prepare(
    `UPDATE documents SET doc_type=?, customer_cid=?, customer_name=?, doc_number=?, dob=?,
     issue_date=?, expiry_date=?, issuing_authority=?, branch=?, notes=? WHERE id=?`
  ).run(doc_type, customer_cid, customer_name, doc_number, dob, issue_date, expiry_date, issuing_authority, branch, notes, req.params.id);
  res.redirect('/documents/indexing');
});

router.get('/:id/download', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).send('Not found');
  const filePath = path.join(__dirname, '..', 'uploads', doc.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
  res.download(filePath, doc.original_name);
});

router.post('/:id/sign', rbac.require('approve'), async (req, res) => {
  try {
    const { signPdf } = require('../services/sign');
    const result = await signPdf(req.params.id, req.session.user);
    res.redirect('/documents/viewer/' + req.params.id);
  } catch (err) {
    res.status(400).send('Sign error: ' + err.message);
  }
});

router.post('/:id/delete', rbac.require('delete'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (doc) {
    const fp = path.join(__dirname, '..', 'uploads', doc.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  }
  res.redirect('/documents');
});

module.exports = router;

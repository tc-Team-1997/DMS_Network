const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { listVersions, uploadNewVersion } = require('../services/versioning');
const rbac = require('../services/rbac');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/:docId', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.docId);
  if (!doc) return res.status(404).send('Not found');
  const versions = listVersions(req.params.docId);
  res.render('versions', { active: 'repository', doc, versions });
});

router.post('/:docId/upload', rbac.require('upload'), upload.single('file'), (req, res) => {
  uploadNewVersion(req.params.docId, req.file, req.session.user.id, req.body.note);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)')
    .run(req.session.user.id, 'NEW_VERSION', 'document', req.params.docId, req.body.note || '');
  res.redirect('/versions/' + req.params.docId);
});

router.get('/:docId/download/:verId', (req, res) => {
  const v = db.prepare('SELECT * FROM document_versions WHERE id=? AND doc_id=?').get(req.params.verId, req.params.docId);
  if (!v) return res.status(404).send('Not found');
  const fp = path.join(__dirname, '..', 'uploads', v.filename);
  if (!fs.existsSync(fp)) return res.status(404).send('File missing');
  res.download(fp, `v${v.version}-${v.filename}`);
});

module.exports = router;

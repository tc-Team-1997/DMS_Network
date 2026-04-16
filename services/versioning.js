const fs = require('fs');
const path = require('path');
const db = require('../db');

function snapshot(docId, changeNote, userId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc) return null;
  db.prepare(
    'INSERT INTO document_versions (doc_id, version, filename, size, changed_by, change_note) VALUES (?,?,?,?,?,?)'
  ).run(docId, doc.version || 'v1.0', doc.filename, doc.size || 0, userId || null, changeNote || null);
}

function listVersions(docId) {
  return db.prepare('SELECT v.*, u.username FROM document_versions v LEFT JOIN users u ON v.changed_by=u.id WHERE v.doc_id=? ORDER BY v.id DESC').all(docId);
}

function uploadNewVersion(docId, file, userId, note) {
  snapshot(docId, note || 'Replaced file', userId);
  const current = db.prepare('SELECT version FROM documents WHERE id=?').get(docId);
  const nextVersion = bumpMinor(current.version);
  db.prepare('UPDATE documents SET filename=?, size=?, mime_type=?, version=? WHERE id=?')
    .run(file.filename, file.size, file.mimetype, nextVersion, docId);
  return nextVersion;
}

function bumpMinor(v) {
  if (!v) return 'v1.1';
  const m = v.match(/^v(\d+)\.(\d+)$/);
  if (!m) return 'v1.1';
  return `v${m[1]}.${parseInt(m[2]) + 1}`;
}

module.exports = { snapshot, listVersions, uploadNewVersion };

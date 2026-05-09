const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../../db');
const { runOcr } = require('../../services/ocr');
const rbac = require('../../services/rbac');
const { branchScope, requirePermJson, tenantScope } = require('./_shared');

/**
 * Write a row to audit_log.
 * Kept inline here; no separate services/audit.js exists yet.
 */
function writeAudit({ userId, action, entity, entityId, details, tenantId }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    action,
    entity,
    entityId,
    typeof details === 'string' ? details : JSON.stringify(details),
    tenantId || 'nbe'
  );
}

// Columns on the `documents` table that also exist as canonical metadata keys.
// When the client sends matching keys in metadata_json (or legacy flat
// fields), we mirror them into these columns so FTS, Reports, and the
// Viewer's fixed metadata dl keep working unchanged.
const MIRRORED_COLUMNS = [
  'customer_cid', 'customer_name', 'doc_number',
  'dob', 'issue_date', 'expiry_date', 'issuing_authority',
];

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const safeName = (s) => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename:    (_req, file, cb) => cb(null, `${Date.now()}-${safeName(file.originalname)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) return cb(new Error('mime_not_allowed'));
    cb(null, true);
  },
});

router.get('/documents', (req, res) => {
  const scope = branchScope(req.session.user);
  const { status, type, folder, q, limit = 100 } = req.query;
  let sql = 'SELECT * FROM documents WHERE 1=1';
  const params = [];
  if (scope)  { sql += ' AND branch = ?';        params.push(scope); }
  if (status) { sql += ' AND status = ?';        params.push(String(status)); }
  if (type)   { sql += ' AND doc_type = ?';      params.push(String(type)); }
  if (folder) { sql += ' AND folder_id = ?';     params.push(parseInt(String(folder), 10)); }
  if (q) {
    sql += ' AND (original_name LIKE ? OR customer_name LIKE ? OR customer_cid LIKE ? OR doc_number LIKE ?)';
    const like = `%${String(q)}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY uploaded_at DESC LIMIT ?';
  params.push(Math.min(parseInt(String(limit), 10) || 100, 500));
  res.json(db.prepare(sql).all(...params));
});

router.get('/documents/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!doc) return res.status(404).json({ error: 'not_found' });

  // Branch permission: Maker and Viewer can only see docs from their branch.
  const user = req.session.user;
  if ((user.role === 'Maker' || user.role === 'Viewer') && user.branch && doc.branch && doc.branch !== user.branch) {
    return res.status(403).json({ error: 'forbidden', detail: 'out_of_branch' });
  }

  // Truncate ocr_text to 500 chars for the polling endpoint; full text is
  // available via the file download / docbrain analyze path.
  const ocr_text_preview = typeof doc.ocr_text === 'string' && doc.ocr_text.length > 500
    ? doc.ocr_text.slice(0, 500) + '…'
    : (doc.ocr_text || null);

  res.json({
    ...doc,
    ocr_text:   ocr_text_preview,
    // Normalise field names the SPA polls on.
    confidence: doc.ocr_confidence ?? null,
    created_at: doc.uploaded_at,
  });
});

router.post(
  '/documents',
  requirePermJson('capture'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const tenant = tenantScope(req);
    const body = req.body ?? {};
    const { doc_type, branch, folder_id, notes } = body;

    // Parse the caller-supplied metadata blob. Legacy flat fields (from
    // older clients / the EJS UI) are merged in so both shapes work.
    let metadata = {};
    if (typeof body.metadata_json === 'string' && body.metadata_json.trim()) {
      try { metadata = JSON.parse(body.metadata_json); } catch {
        return res.status(400).json({ error: 'invalid_metadata_json' });
      }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return res.status(400).json({ error: 'metadata_must_be_object' });
      }
    }
    // Merge legacy fields — don't overwrite values that are already in metadata.
    for (const col of MIRRORED_COLUMNS) {
      if (metadata[col] == null && typeof body[col] === 'string' && body[col].trim()) {
        metadata[col] = body[col].trim();
      }
    }

    // If a schema exists for the doc_type, enforce its required fields.
    if (doc_type) {
      const schemaRow = db.prepare(
        'SELECT fields_json FROM document_type_schemas WHERE name = ? AND tenant_id = ? AND active = 1',
      ).get(doc_type, tenant);
      if (schemaRow) {
        let fields = [];
        try { fields = JSON.parse(schemaRow.fields_json || '[]'); } catch { fields = []; }
        const missing = [];
        for (const f of fields) {
          if (!f || !f.required) continue;
          const value = metadata[f.key];
          if (value == null || (typeof value === 'string' && value.trim() === '')) {
            missing.push(f.key);
          }
        }
        if (missing.length > 0) {
          return res.status(400).json({ error: 'missing_required_fields', fields: missing });
        }
      }
    }

    // Pull the mirrored columns out of metadata for the flat-column write.
    const flat = {};
    for (const col of MIRRORED_COLUMNS) {
      const v = metadata[col];
      flat[col] = typeof v === 'string' && v.trim() ? v.trim() : null;
    }

    const info = db.prepare(
      `INSERT INTO documents
         (filename, original_name, doc_type, customer_cid, customer_name,
          doc_number, dob, issue_date, expiry_date, issuing_authority,
          branch, folder_id, status, version, size, mime_type, notes,
          uploaded_by, tenant_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Valid', 'v1.0', ?, ?, ?, ?, ?, ?)`,
    ).run(
      req.file.filename, req.file.originalname,
      doc_type || null,
      flat.customer_cid, flat.customer_name, flat.doc_number,
      flat.dob, flat.issue_date, flat.expiry_date, flat.issuing_authority,
      branch || req.session.user.branch || null,
      folder_id ? parseInt(folder_id, 10) : null,
      req.file.size, req.file.mimetype, notes || null,
      req.session.user.id, tenant,
      JSON.stringify(metadata),
    );
    const id = info.lastInsertRowid;

    // Kick off Tesseract (image-only fast path). The richer Python pipeline
    // fills ocr_confidence via /spa/api/docbrain/analyze later.
    runOcr(id).catch(() => {});

    res.json({ ok: true, id });
  },
);

router.delete('/documents/:id', requirePermJson('delete'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const doc = db.prepare('SELECT filename FROM documents WHERE id = ?').get(id);
  if (!doc) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  fs.unlink(path.join(uploadsDir, doc.filename), () => {});
  res.json({ ok: true });
});

/**
 * POST /spa/api/documents/:id/rollback/:versionId   (BRD #16)
 *
 * Rolls a document back to a previous version.  History is append-only:
 * a new row is inserted into document_versions and documents is updated to
 * point at that new row's filename/version.  Requires 'admin' permission.
 */
router.post('/documents/:id/rollback/:versionId', (req, res) => {
  const role = req.session.user?.role;
  if (!role || !rbac.can(role, 'admin')) {
    return res.status(403).json({ error: 'forbidden', perm: 'admin' });
  }

  const docId = parseInt(req.params.id, 10);
  const versionId = parseInt(req.params.versionId, 10);
  const userId = req.session.user.id;
  const tenantId = req.session.user.tenant_id || 'nbe';

  // 1. Verify the document exists.
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc) return res.status(404).json({ error: 'document_not_found' });

  // 2. Verify the target version exists and belongs to this document.
  const targetVer = db.prepare(
    'SELECT * FROM document_versions WHERE id = ? AND doc_id = ?'
  ).get(versionId, docId);
  if (!targetVer) return res.status(404).json({ error: 'version_not_found' });

  // 3. Compute next version label (vN.0 where N = max existing + 1).
  const maxRow = db.prepare(
    'SELECT COUNT(*) AS cnt FROM document_versions WHERE doc_id = ?'
  ).get(docId);
  const nextN = (maxRow ? maxRow.cnt : 0) + 1;
  const newVersionLabel = `v${nextN}.0`;

  // 4. Insert a new document_versions row (append-only).
  const insInfo = db.prepare(
    `INSERT INTO document_versions (doc_id, version, filename, size, changed_by, change_note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    docId,
    newVersionLabel,
    targetVer.filename,
    targetVer.size,
    userId,
    `rollback to version ${targetVer.version} (id=${versionId})`
  );
  const newVersionId = insInfo.lastInsertRowid;

  // 5. Update documents to reflect the restored state.
  db.prepare(
    'UPDATE documents SET filename = ?, version = ? WHERE id = ?'
  ).run(targetVer.filename, newVersionLabel, docId);

  // 6. Write audit trail.
  writeAudit({
    userId,
    action: 'rollback',
    entity: 'document',
    entityId: docId,
    details: {
      from_version_id: versionId,
      to_version_id: newVersionId,
      user_id: userId,
    },
    tenantId,
  });

  return res.json({ ok: true, new_version_id: newVersionId, new_version_number: newVersionLabel });
});

module.exports = router;
module.exports.uploadsDir = uploadsDir;

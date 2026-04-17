/**
 * SPA-facing JSON API for apps/web. All routes are session-authenticated
 * via the same express-session cookie used by the EJS app — no tokens in
 * localStorage. RBAC mirrors services/rbac.js.
 *
 * Mounted at /spa/api in server.js.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const db = require('../db');
const rbac = require('../services/rbac');
const { runOcr } = require('../services/ocr');

const router = express.Router();

// DocBrain (Python service) — session-authenticated SPA clients reach it
// through these wrappers. Secret (X-API-Key) never leaves the Node process.
const PY_BASE = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001';
const PY_KEY  = process.env.PYTHON_SERVICE_KEY || 'dev-key-change-me';

function pyCall(subpath, { method = 'GET', body = null, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(subpath, PY_BASE);
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      method,
      headers: {
        'X-API-Key': PY_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    const req = lib.request(url, opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const err = new Error(`python ${res.statusCode}`);
        err.status = res.statusCode;
        err.data = parsed;
        reject(err);
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error('python timeout')); });
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------- helpers ---------------------------------------------------------

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    branch: u.branch,
  };
}

function requireAuthJson(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

function requirePermJson(perm) {
  return (req, res, next) => {
    const role = req.session.user?.role;
    if (!role || !rbac.can(role, perm)) {
      return res.status(403).json({ error: 'forbidden', perm });
    }
    next();
  };
}

function branchScope(user) {
  return (user.role === 'Viewer' || user.role === 'Maker') && user.branch
    ? user.branch
    : null;
}

// ---------- auth ------------------------------------------------------------

router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (user.status === 'Locked') {
    return res.status(403).json({ error: 'account_locked' });
  }
  // MFA is enforced on the EJS /login path; SPA deliberately skips it for now.
  req.session.user = publicUser(user);
  db.prepare('INSERT INTO audit_log (user_id, action, entity) VALUES (?, ?, ?)')
    .run(user.id, 'SPA_LOGIN', 'user');
  res.json({ ok: true, user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  res.json({ user: req.session.user ?? null });
});

// ---------- everything below requires a session ----------------------------

router.use(requireAuthJson);

// ---------- stats -----------------------------------------------------------

router.get('/stats', (req, res) => {
  const scope = branchScope(req.session.user);
  const branchClause = scope ? ' AND branch = ?' : '';
  const p = scope ? [scope] : [];
  const count = (predicate) =>
    db.prepare(`SELECT COUNT(*) c FROM documents WHERE ${predicate}${branchClause}`).get(...p).c;

  res.json({
    total:             count('1 = 1'),
    valid:             count("status = 'Valid'"),
    expired:           count("status = 'Expired'"),
    expiring:          count("status = 'Expiring'"),
    pending_workflows: db.prepare("SELECT COUNT(*) c FROM workflows WHERE stage <> 'Approved'").get().c,
    unread_alerts:     db.prepare('SELECT COUNT(*) c FROM alerts WHERE is_read = 0').get().c,
  });
});

router.get('/stats/expiry', (req, res) => {
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN expiry_date IS NULL THEN 'No expiry'
        WHEN expiry_date < date('now') THEN 'Expired'
        WHEN expiry_date < date('now','+30 days') THEN '< 30 days'
        WHEN expiry_date < date('now','+90 days') THEN '30–90 days'
        WHEN expiry_date < date('now','+365 days') THEN '3–12 months'
        ELSE '> 1 year'
      END AS bucket,
      COUNT(*) c
    FROM documents GROUP BY bucket
  `).all();
  const order = ['Expired', '< 30 days', '30–90 days', '3–12 months', '> 1 year', 'No expiry'];
  const map = Object.fromEntries(rows.map((r) => [r.bucket, r.c]));
  res.json({
    labels: order,
    counts: order.map((k) => map[k] ?? 0),
  });
});

router.get('/stats/doc-types', (req, res) => {
  const rows = db.prepare(`
    SELECT COALESCE(doc_type, 'Uncategorized') doc_type, COUNT(*) count
    FROM documents GROUP BY doc_type ORDER BY count DESC LIMIT 8
  `).all();
  res.json(rows);
});

// ---------- folders ---------------------------------------------------------

router.get('/folders', (req, res) => {
  res.json(db.prepare('SELECT * FROM folders ORDER BY parent_id, name').all());
});

// ---------- documents -------------------------------------------------------

const uploadsDir = path.join(__dirname, '..', 'uploads');
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
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return cb(new Error('mime_not_allowed'));
    }
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
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!doc) return res.status(404).json({ error: 'not_found' });
  res.json(doc);
});

router.post(
  '/documents',
  requirePermJson('capture'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const {
      doc_type, customer_cid, customer_name, doc_number,
      dob, issue_date, expiry_date, issuing_authority,
      branch, folder_id, notes,
    } = req.body ?? {};
    const info = db.prepare(
      `INSERT INTO documents (filename, original_name, doc_type, customer_cid, customer_name,
         doc_number, dob, issue_date, expiry_date, issuing_authority, branch, folder_id,
         status, version, size, mime_type, notes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Valid', 'v1.0', ?, ?, ?, ?)`,
    ).run(
      req.file.filename, req.file.originalname,
      doc_type || null, customer_cid || null, customer_name || null,
      doc_number || null, dob || null, issue_date || null, expiry_date || null,
      issuing_authority || null, branch || req.session.user.branch || null,
      folder_id ? parseInt(folder_id, 10) : null,
      req.file.size, req.file.mimetype, notes || null,
      req.session.user.id,
    );
    const id = info.lastInsertRowid;

    // Fire-and-forget OCR; errors are logged, not surfaced to the client.
    runOcr(path.join(uploadsDir, req.file.filename), req.file.mimetype)
      .then((r) => {
        db.prepare('UPDATE documents SET ocr_text = ?, ocr_confidence = ? WHERE id = ?')
          .run(r.text ?? null, r.confidence ?? null, id);
      })
      .catch(() => {});

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

// ---------- workflows -------------------------------------------------------

router.get('/workflows', (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? 100), 10) || 100, 500);
  res.json(db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC LIMIT ?').all(limit));
});

router.post('/workflows/:id/actions', requirePermJson('workflow'), (req, res) => {
  const { action } = req.body ?? {};
  const stageMap = { approve: 'Approved', reject: 'Rejected - Rework', escalate: 'Manager Sign-off' };
  const stage = stageMap[action];
  if (!stage) return res.status(400).json({ error: 'invalid_action' });
  db.prepare('UPDATE workflows SET stage=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(stage, parseInt(req.params.id, 10));
  res.json({ ok: true, stage });
});

// ---------- alerts ----------------------------------------------------------

router.get('/alerts', (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 500);
  res.json(db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?').all(limit));
});

router.post('/alerts/:id/read', (req, res) => {
  db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

// ---------- search (FTS5) ---------------------------------------------------

router.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json([]);
  // Escape FTS syntax by wrapping each word in quotes.
  const match = q.split(/\s+/).map((w) => `"${w.replace(/"/g, '""')}"`).join(' ');
  const sql = `
    SELECT d.* FROM documents_fts f
    JOIN documents d ON d.id = f.rowid
    WHERE documents_fts MATCH ?
    ORDER BY d.uploaded_at DESC
    LIMIT 100
  `;
  try {
    res.json(db.prepare(sql).all(match));
  } catch {
    res.json([]);
  }
});

// ---------- DocBrain (AI) ---------------------------------------------------
// Session-auth + RBAC-gated proxies to the Python DocBrain service.
// The Python service key is injected server-side; browser never sees it.

router.get('/docbrain/health', async (req, res) => {
  try {
    const data = await pyCall('/api/v1/docbrain/health');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'docbrain_unreachable', detail: err.message });
  }
});

router.post('/docbrain/analyze', requirePermJson('capture'), async (req, res) => {
  const { document_id, text, bytes_b64, mime_type } = req.body ?? {};
  const id = parseInt(document_id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'document_id required' });

  // If text is not supplied, pull from the document row's file on disk,
  // base64 it, and let DocBrain OCR it. This keeps the browser out of
  // the OCR payload path.
  let body;
  if (text) {
    body = { document_id: id, text: String(text) };
  } else {
    const doc = db.prepare('SELECT filename, mime_type FROM documents WHERE id = ?').get(id);
    if (!doc) return res.status(404).json({ error: 'document_not_found' });
    const filepath = path.join(__dirname, '..', 'uploads', doc.filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'file_missing' });
    const buf = fs.readFileSync(filepath);
    body = {
      document_id: id,
      bytes_b64:   buf.toString('base64'),
      mime_type:   mime_type || doc.mime_type || 'application/octet-stream',
    };
  }

  try {
    const data = await pyCall('/api/v1/docbrain/analyze', { method: 'POST', body });
    // Persist classification + high-confidence extraction back onto the document row
    // so the existing Repository/Viewer metadata stays in sync with AI's verdict.
    if (data?.classification?.doc_class && data.classification.doc_class !== 'Unknown') {
      db.prepare('UPDATE documents SET doc_type = COALESCE(doc_type, ?) WHERE id = ?')
        .run(data.classification.doc_class, id);
    }
    const prefill = data?.extraction ?? {};
    const pull = (field) => {
      const f = prefill[field];
      return f && f.value && f.confidence >= 0.7 ? f.value : null;
    };
    db.prepare(
      `UPDATE documents SET
         customer_cid      = COALESCE(customer_cid,      ?),
         customer_name     = COALESCE(customer_name,     ?),
         doc_number        = COALESCE(doc_number,        ?),
         dob               = COALESCE(dob,               ?),
         issue_date        = COALESCE(issue_date,        ?),
         expiry_date       = COALESCE(expiry_date,       ?),
         issuing_authority = COALESCE(issuing_authority, ?)
       WHERE id = ?`,
    ).run(
      pull('customer_cid'), pull('customer_name'), pull('doc_number'),
      pull('dob'), pull('issue_date'), pull('expiry_date'),
      pull('issuing_authority'), id,
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'analyze_failed', detail: err.message, data: err.data });
  }
});

router.get('/docbrain/document/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const data = await pyCall(`/api/v1/docbrain/document/${id}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'analysis_fetch_failed', detail: err.message });
  }
});

router.post('/docbrain/extract', requirePermJson('capture'), async (req, res) => {
  const { text } = req.body ?? {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' });
  try {
    const data = await pyCall('/api/v1/docbrain/extract', {
      method: 'POST', body: { text },
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'extract_failed', detail: err.message });
  }
});

router.post('/docbrain/chat', async (req, res) => {
  const { question, document_id } = req.body ?? {};
  if (!question) return res.status(400).json({ error: 'question required' });
  try {
    const data = await pyCall('/api/v1/docbrain/chat', {
      method: 'POST',
      body: {
        question: String(question),
        document_id: Number.isFinite(parseInt(document_id, 10)) ? parseInt(document_id, 10) : null,
      },
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'chat_failed', detail: err.message });
  }
});

module.exports = router;

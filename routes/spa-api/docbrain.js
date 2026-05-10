const express = require('express');
const multer = require('multer');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const db = require('../../db');
const { pyCall, requirePermJson } = require('./_shared');
const { uploadsDir } = require('./documents');
const { buildPolicyDecision } = require('../../services/audit-policy');

const PY_BASE = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001';
const PY_KEY  = process.env.PYTHON_SERVICE_KEY || 'dev-key-change-me';

const router = express.Router();

// In-memory multer used only by /preview — bytes are base64'd and forwarded
// to Python, never written to disk (that happens on the real /documents upload).
const ALLOWED_PREVIEW_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const previewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // previews stay small to keep OCR snappy
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_PREVIEW_MIMES.has(file.mimetype)) return cb(new Error('mime_not_allowed'));
    cb(null, true);
  },
});

router.get('/docbrain/health', async (_req, res) => {
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

  let body;
  if (text) {
    body = { document_id: id, text: String(text) };
  } else {
    const doc = db.prepare('SELECT filename, mime_type FROM documents WHERE id = ?').get(id);
    if (!doc) return res.status(404).json({ error: 'document_not_found' });
    const filepath = path.join(uploadsDir, doc.filename);
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
    if (data?.classification?.doc_class && data.classification.doc_class !== 'Unknown') {
      db.prepare('UPDATE documents SET doc_type = COALESCE(doc_type, ?) WHERE id = ?')
        .run(data.classification.doc_class, id);
    }
    // Mirror OCR confidence back onto the flat row so Viewer / Repository
    // / Reports see a real number instead of 'pending'. Python returns a
    // 0..100 mean confidence on the `ocr` summary block.
    const meanConf = typeof data?.ocr?.mean_confidence === 'number'
      ? data.ocr.mean_confidence : null;
    if (meanConf != null) {
      db.prepare('UPDATE documents SET ocr_confidence = ? WHERE id = ?')
        .run(meanConf, id);
    }
    const prefill = data?.extraction ?? {};
    const pull = (field) => {
      const f = prefill[field];
      return f && f.value && f.confidence >= 0.7 ? f.value : null;
    };
    // Mirror into flat columns (Repository / FTS / Reports keep working).
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

    // Also merge the full extraction (incl. address and anything new) into
    // documents.metadata_json so dynamic schemas see it too. User-entered
    // values are preserved; we only fill empty keys. A reserved `_ai`
    // sub-object carries provenance (classification reasoning, OCR backend,
    // confidence) so the Viewer can render a full audit trail.
    try {
      const row = db.prepare('SELECT metadata_json FROM documents WHERE id = ?').get(id);
      let meta = {};
      if (row && typeof row.metadata_json === 'string' && row.metadata_json.trim()) {
        try { meta = JSON.parse(row.metadata_json); } catch { meta = {}; }
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
      }
      // Merge extracted fields — don't clobber user-entered values.
      for (const key of ['customer_cid','customer_name','doc_number','dob','issue_date','expiry_date','issuing_authority','address']) {
        const v = pull(key);
        if (v && (meta[key] == null || meta[key] === '')) {
          meta[key] = v;
        }
      }
      // Provenance / AI audit trail.
      meta._ai = {
        classification: data?.classification ?? null,
        ocr: data?.ocr ?? null,
        chunks_indexed: typeof data?.chunks_indexed === 'number' ? data.chunks_indexed : null,
        extracted_at: new Date().toISOString(),
      };
      // Full field confidence map — lets the UI show which AI values were
      // trusted vs flagged for verification.
      meta._ai_fields = Object.fromEntries(
        Object.entries(prefill).map(([k, v]) => [k, {
          value: v?.value ?? null,
          confidence: typeof v?.confidence === 'number' ? v.confidence : 0,
        }]),
      );
      db.prepare('UPDATE documents SET metadata_json = ? WHERE id = ?')
        .run(JSON.stringify(meta), id);
    } catch (err) {
      // Non-fatal; the flat-column mirror succeeded already.
      console.error('[analyze] metadata_json merge failed:', err.message);
    }

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

/**
 * Pre-upload preview. Multipart file in, {classification, extraction, ocr,
 * prefill} out. Nothing is persisted. Used by Capture to auto-fill the form.
 */
router.post(
  '/docbrain/preview',
  requirePermJson('capture'),
  previewUpload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const body = {
      bytes_b64: req.file.buffer.toString('base64'),
      mime_type: req.file.mimetype,
    };
    try {
      const data = await pyCall('/api/v1/docbrain/preview', { method: 'POST', body });
      res.json(data);
    } catch (err) {
      res.status(err.status || 502).json({
        error: 'preview_failed',
        detail: err.message,
        data: err.data,
      });
    }
  },
);

/**
 * Per-document SSE chat. Stateless — no history, no persistence. Used by
 * the Viewer's "Ask the document" panel. Proxies the Python LangChain
 * path (MultiQuery + BM25 hybrid rerank).
 */
router.post('/docbrain/chat/stream', (req, res) => {
  const { question, document_id, history } = req.body ?? {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question required' });
  }
  const did = Number.isFinite(parseInt(document_id, 10)) ? parseInt(document_id, 10) : null;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const pyUrl = new URL('/api/v1/docbrain/chat/stream', PY_BASE);
  const lib = pyUrl.protocol === 'https:' ? https : http;
  const body = JSON.stringify({
    question: String(question).trim(),
    history: Array.isArray(history) ? history.slice(-8) : [],
    ...(did != null ? { document_id: did } : {}),
  });
  const pyReq = lib.request(pyUrl, {
    method: 'POST',
    headers: {
      'X-API-Key': PY_KEY,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Content-Length': Buffer.byteLength(body),
    },
  });
  pyReq.on('response', (pyRes) => {
    if (pyRes.statusCode >= 400) {
      res.write(`data: ${JSON.stringify({ type: 'error', status: pyRes.statusCode })}\n\n`);
      res.end();
      return;
    }
    pyRes.setEncoding('utf-8');
    pyRes.on('data', (chunk) => res.write(chunk));
    pyRes.on('end',   () => res.end());
    pyRes.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });
  });
  pyReq.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  });
  req.on('close', () => { try { pyReq.destroy(); } catch { /* ignore */ } });
  pyReq.write(body);
  pyReq.end();
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

// ---------------------------------------------------------------------------
// DocBrain Chat v2 — conversation persistence, FTS, pin, folder, edit,
// regenerate. All proxy routes forward X-User-Id + X-Tenant-Id so the Python
// layer can enforce ownership without its own auth stack.
// ---------------------------------------------------------------------------

/** Shared headers injected into every v2 call so Python can resolve ownership. */
function v2Headers(req) {
  const user = req.session && req.session.user;
  return {
    'X-API-Key':    PY_KEY,
    'Content-Type': 'application/json',
    ...(user ? {
      'X-User-Id':   String(user.id),
      'X-Tenant-Id': String(user.tenant_id || 'nbe'),
    } : {
      'X-User-Id':   '1',
      'X-Tenant-Id': 'nbe',
    }),
  };
}

/** Simple async JSON proxy helper for v2 non-streaming routes.
 * Uses a direct http.request so we can inject X-User-Id / X-Tenant-Id headers
 * that pyCall (which only sends X-API-Key) doesn't support.
 */
function proxyV2(method, pyPath, body, req, res) {
  return new Promise((resolve) => {
    const pyUrl = new URL(pyPath, PY_BASE);
    const lib = pyUrl.protocol === 'https:' ? https : http;
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {
      ...v2Headers(req),
      'Accept': 'application/json',
    };
    if (payload !== null) headers['Content-Length'] = Buffer.byteLength(payload);
    const pyReq = lib.request(pyUrl, { method, headers });
    const chunks = [];
    pyReq.on('response', (pyRes) => {
      pyRes.on('data', (c) => chunks.push(c));
      pyRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        if (pyRes.statusCode >= 200 && pyRes.statusCode < 300) {
          res.json(parsed);
        } else {
          res.status(pyRes.statusCode || 502).json({ error: 'docbrain_v2_proxy_failed', detail: parsed });
        }
        resolve();
      });
    });
    pyReq.on('error', (err) => {
      res.status(502).json({ error: 'docbrain_v2_proxy_failed', detail: err.message });
      resolve();
    });
    pyReq.setTimeout(600_000, () => { pyReq.destroy(new Error('timeout')); });
    if (payload !== null) pyReq.write(payload);
    pyReq.end();
  });
}

// GET /spa/api/docbrain/v2/conversations[?q=&limit=]
router.get('/docbrain/v2/conversations', async (req, res) => {
  const { q, limit } = req.query;
  const qs = [
    q ? `q=${encodeURIComponent(q)}` : null,
    limit ? `limit=${encodeURIComponent(limit)}` : null,
  ].filter(Boolean).join('&');
  const path = `/api/v1/docbrain/conversations${qs ? `?${qs}` : ''}`;
  await proxyV2('GET', path, undefined, req, res);
});

// POST /spa/api/docbrain/v2/conversations
router.post('/docbrain/v2/conversations', async (req, res) => {
  const { title, persona, folder, model_used } = req.body ?? {};
  await proxyV2('POST', '/api/v1/docbrain/conversations', { title, persona, folder, model_used }, req, res);
});

// GET /spa/api/docbrain/v2/conversations/:id
router.get('/docbrain/v2/conversations/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  await proxyV2('GET', `/api/v1/docbrain/conversations/${id}`, undefined, req, res);
});

// POST /spa/api/docbrain/v2/conversations/:id/messages  — SSE stream
router.post('/docbrain/v2/conversations/:id/messages', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid conversation id' });
  const { question, document_id } = req.body ?? {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question required' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const pyUrl = new URL(`/api/v1/docbrain/conversations/${id}/messages`, PY_BASE);
  const lib = pyUrl.protocol === 'https:' ? https : http;
  const bodyStr = JSON.stringify({
    question: String(question).trim(),
    ...(Number.isFinite(parseInt(document_id, 10)) ? { document_id: parseInt(document_id, 10) } : {}),
  });
  const pyReq = lib.request(pyUrl, {
    method: 'POST',
    headers: {
      ...v2Headers(req),
      'Accept': 'text/event-stream',
      'Content-Length': Buffer.byteLength(bodyStr),
    },
  });
  pyReq.on('response', (pyRes) => {
    if (pyRes.statusCode >= 400) {
      res.write(`data: ${JSON.stringify({ type: 'error', status: pyRes.statusCode })}\n\n`);
      res.end();
      return;
    }
    pyRes.setEncoding('utf-8');
    pyRes.on('data', (chunk) => res.write(chunk));
    pyRes.on('end', () => res.end());
    pyRes.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });
  });
  pyReq.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  });
  req.on('close', () => { try { pyReq.destroy(); } catch { /* ignore */ } });
  pyReq.write(bodyStr);
  pyReq.end();
});

// PATCH /spa/api/docbrain/v2/messages/:id?conversation_id=
router.patch('/docbrain/v2/messages/:id', async (req, res) => {
  const msgId = parseInt(req.params.id, 10);
  const convId = parseInt(req.query.conversation_id, 10);
  if (!Number.isFinite(msgId) || !Number.isFinite(convId)) {
    return res.status(400).json({ error: 'message id and conversation_id required' });
  }
  const { content } = req.body ?? {};
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  await proxyV2(
    'PATCH',
    `/api/v1/docbrain/messages/${msgId}?conversation_id=${convId}`,
    { content },
    req,
    res,
  );
});

// POST /spa/api/docbrain/v2/messages/:id/regenerate?conversation_id=  — SSE stream
router.post('/docbrain/v2/messages/:id/regenerate', (req, res) => {
  const msgId = parseInt(req.params.id, 10);
  const convId = parseInt(req.query.conversation_id, 10);
  if (!Number.isFinite(msgId) || !Number.isFinite(convId)) {
    return res.status(400).json({ error: 'message id and conversation_id required' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const pyUrl = new URL(
    `/api/v1/docbrain/messages/${msgId}/regenerate?conversation_id=${convId}`,
    PY_BASE,
  );
  const lib = pyUrl.protocol === 'https:' ? https : http;
  const bodyStr = '{}';
  const pyReq = lib.request(pyUrl, {
    method: 'POST',
    headers: {
      ...v2Headers(req),
      'Accept': 'text/event-stream',
      'Content-Length': Buffer.byteLength(bodyStr),
    },
  });
  pyReq.on('response', (pyRes) => {
    if (pyRes.statusCode >= 400) {
      res.write(`data: ${JSON.stringify({ type: 'error', status: pyRes.statusCode })}\n\n`);
      res.end();
      return;
    }
    pyRes.setEncoding('utf-8');
    pyRes.on('data', (chunk) => res.write(chunk));
    pyRes.on('end', () => res.end());
    pyRes.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });
  });
  pyReq.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  });
  req.on('close', () => { try { pyReq.destroy(); } catch { /* ignore */ } });
  pyReq.write(bodyStr);
  pyReq.end();
});

// POST /spa/api/docbrain/v2/conversations/:id/pin
router.post('/docbrain/v2/conversations/:id/pin', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const { pinned } = req.body ?? {};
  if (typeof pinned !== 'boolean') return res.status(400).json({ error: 'pinned (bool) required' });
  await proxyV2('POST', `/api/v1/docbrain/conversations/${id}/pin`, { pinned }, req, res);
});

// POST /spa/api/docbrain/v2/conversations/:id/folder
router.post('/docbrain/v2/conversations/:id/folder', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const { folder } = req.body ?? {};
  await proxyV2('POST', `/api/v1/docbrain/conversations/${id}/folder`, { folder: folder ?? null }, req, res);
});

// ---------------------------------------------------------------------------
// Document-type learning ("learn from samples") — 8 pass-through endpoints
// ---------------------------------------------------------------------------

// Inline audit — writeAudit is not exported from documents.js.
function writeAudit({ userId, action, entity, entityId, details, tenantId, policyDecision = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id, policy_decision)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, action, entity, entityId,
    typeof details === 'string' ? details : JSON.stringify(details),
    tenantId || 'nbe',
    policyDecision !== null ? JSON.stringify(policyDecision) : null);
}

// Batch multer — up to 10 files, 25 MB each, same MIME whitelist.
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_PREVIEW_MIMES.has(file.mimetype)) return cb(new Error('mime_not_allowed'));
    cb(null, true);
  },
});

// Encode multer file array → base64 list for Python.
const encodeFiles = (files) => (files || []).map((f) => ({
  filename: f.originalname, mime_type: f.mimetype, bytes_b64: f.buffer.toString('base64'),
}));

// Parse optional JSON blob field from multipart body.
function parseBlob(req, res) {
  if (!req.body.blob || !String(req.body.blob).trim()) return {};
  try { return JSON.parse(req.body.blob); } catch {
    res.status(400).json({ error: 'invalid_blob_json' }); return null;
  }
}

// Pass-through factory for file-less doctype GET/DELETE routes.
function proxyDoctype(method, pySubpath) {
  return async (req, res) => {
    const subpath = typeof pySubpath === 'function' ? pySubpath(req) : pySubpath;
    const opts = { method };
    if (method !== 'GET' && method !== 'DELETE') opts.body = req.body ?? {};
    try { res.json(await pyCall(subpath, opts)); }
    catch (err) { res.status(err.status || 502).json({ error: 'doctype_proxy_failed', detail: err.message, data: err.data }); }
  };
}

const dtPath = (id) => `/api/v1/docbrain/doctypes/${encodeURIComponent(id)}`;

// POST /spa/api/docbrain/doctypes/infer — up to 10 files, 30 min
router.post('/docbrain/doctypes/infer', requirePermJson('admin'), batchUpload.array('files', 10),
  async (req, res) => {
    const blob = parseBlob(req, res); if (blob === null) return;
    try {
      const data = await pyCall('/api/v1/docbrain/doctypes/infer', {
        method: 'POST', body: { ...blob, samples: encodeFiles(req.files) }, timeout: 1_800_000,
      });
      writeAudit({ userId: req.session.user.id, action: 'doctype_infer', entity: 'doctype',
        entityId: null, details: { file_count: (req.files || []).length },
        tenantId: req.session.user.tenant_id || 'nbe', policyDecision: buildPolicyDecision(req) });
      res.json(data);
    } catch (err) { res.status(err.status || 502).json({ error: 'doctype_infer_failed', detail: err.message, data: err.data }); }
  });

// POST /spa/api/docbrain/doctypes/commit — up to 10 files, 10 min
router.post('/docbrain/doctypes/commit', requirePermJson('admin'), batchUpload.array('files', 10),
  async (req, res) => {
    const blob = parseBlob(req, res); if (blob === null) return;
    try {
      const data = await pyCall('/api/v1/docbrain/doctypes/commit', {
        method: 'POST', body: { ...blob, samples: encodeFiles(req.files) }, timeout: 600_000,
      });
      writeAudit({ userId: req.session.user.id, action: 'doctype_commit', entity: 'doctype',
        entityId: blob.id ?? null, details: { file_count: (req.files || []).length, blob },
        tenantId: req.session.user.tenant_id || 'nbe', policyDecision: buildPolicyDecision(req) });
      res.json(data);
    } catch (err) { res.status(err.status || 502).json({ error: 'doctype_commit_failed', detail: err.message, data: err.data }); }
  });

// GET /spa/api/docbrain/doctypes/:id/samples
router.get('/docbrain/doctypes/:id/samples', requirePermJson('admin'),
  proxyDoctype('GET', (req) => `${dtPath(req.params.id)}/samples`));

// GET /spa/api/docbrain/doctypes/:id/samples/:sid
router.get('/docbrain/doctypes/:id/samples/:sid', requirePermJson('admin'),
  proxyDoctype('GET', (req) => `${dtPath(req.params.id)}/samples/${encodeURIComponent(req.params.sid)}`))

// GET /spa/api/docbrain/doctypes/:id/samples/:sid/pdf
// Streams the original sample file bytes from Python storage so BboxLabeler
// can render it with PDF.js at full resolution.
router.get('/docbrain/doctypes/:id/samples/:sid/pdf', requirePermJson('admin'), async (req, res) => {
  const pyUrl = new URL(
    `${dtPath(req.params.id)}/samples/${encodeURIComponent(req.params.sid)}/pdf`,
    PY_BASE,
  );
  const lib = pyUrl.protocol === 'https:' ? https : http;
  try {
    await new Promise((resolve, reject) => {
      const pyReq = lib.request(pyUrl, {
        method: 'GET',
        headers: { 'X-API-Key': PY_KEY, Accept: 'application/octet-stream' },
      });
      pyReq.on('response', (pyRes) => {
        if (pyRes.statusCode >= 400) {
          const err = new Error(`python ${pyRes.statusCode}`);
          err.status = pyRes.statusCode;
          return reject(err);
        }
        res.status(200);
        res.setHeader('Content-Type', pyRes.headers['content-type'] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        pyRes.pipe(res);
        pyRes.on('end', resolve);
        pyRes.on('error', reject);
      });
      pyReq.on('error', reject);
      pyReq.setTimeout(30_000, () => pyReq.destroy(new Error('timeout')));
      pyReq.end();
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(err.status || 502).json({ error: 'sample_pdf_failed', detail: err.message });
    }
  }
});

// DELETE /spa/api/docbrain/doctypes/:id/samples/:sid
router.delete('/docbrain/doctypes/:id/samples/:sid', requirePermJson('admin'), async (req, res) => {
  try {
    const data = await pyCall(`${dtPath(req.params.id)}/samples/${encodeURIComponent(req.params.sid)}`, { method: 'DELETE' });
    writeAudit({ userId: req.session.user.id, action: 'doctype_sample_delete', entity: 'doctype_sample',
      entityId: req.params.sid, details: { doctype_id: req.params.id },
      tenantId: req.session.user.tenant_id || 'nbe', policyDecision: buildPolicyDecision(req) });
    res.json(data);
  } catch (err) { res.status(err.status || 502).json({ error: 'doctype_sample_delete_failed', detail: err.message, data: err.data }); }
});

// POST /spa/api/docbrain/doctypes/:id/reindex — 30 min
router.post('/docbrain/doctypes/:id/reindex', requirePermJson('admin'), async (req, res) => {
  try {
    const data = await pyCall(`${dtPath(req.params.id)}/reindex`, { method: 'POST', body: req.body ?? {}, timeout: 1_800_000 });
    writeAudit({ userId: req.session.user.id, action: 'doctype_reindex', entity: 'doctype',
      entityId: req.params.id, details: {}, tenantId: req.session.user.tenant_id || 'nbe', policyDecision: buildPolicyDecision(req) });
    res.json(data);
  } catch (err) { res.status(err.status || 502).json({ error: 'doctype_reindex_failed', detail: err.message, data: err.data }); }
});

// POST /spa/api/docbrain/doctypes/classify-one — single file, capture perm
router.post('/docbrain/doctypes/classify-one', requirePermJson('capture'), previewUpload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const blob = parseBlob(req, res); if (blob === null) return;
    const body = { ...blob, filename: req.file.originalname, mime_type: req.file.mimetype, bytes_b64: req.file.buffer.toString('base64') };
    try { res.json(await pyCall('/api/v1/docbrain/doctypes/classify-one', { method: 'POST', body })); }
    catch (err) { res.status(err.status || 502).json({ error: 'classify_one_failed', detail: err.message, data: err.data }); }
  });

// POST /spa/api/docbrain/doctypes/:id/tamper-check — single file, capture perm
router.post('/docbrain/doctypes/:id/tamper-check', requirePermJson('capture'), previewUpload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const blob = parseBlob(req, res); if (blob === null) return;
    const body = { ...blob, filename: req.file.originalname, mime_type: req.file.mimetype, bytes_b64: req.file.buffer.toString('base64') };
    try { res.json(await pyCall(`${dtPath(req.params.id)}/tamper-check`, { method: 'POST', body })); }
    catch (err) { res.status(err.status || 502).json({ error: 'tamper_check_failed', detail: err.message, data: err.data }); }
  });

module.exports = router;

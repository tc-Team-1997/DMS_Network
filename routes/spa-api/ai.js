/**
 * AI chat gateway. Session-authenticated; proxies the SSE stream from the
 * Python DocBrain service so the X-API-Key never reaches the browser.
 * Backs a ChatGPT-style UI with per-user conversation history persisted
 * in SQLite (`ai_conversations` + `ai_messages`).
 *
 * Endpoints (mounted at /spa/api under the aggregator):
 *   GET    /ai/conversations                → list the caller's conversations
 *   POST   /ai/conversations                → create + return empty shell
 *   GET    /ai/conversations/:id            → conversation + full message log
 *   PATCH  /ai/conversations/:id            → rename / rescope
 *   DELETE /ai/conversations/:id            → cascade-deletes messages
 *   POST   /ai/chat/stream                  → streams assistant tokens (SSE)
 */
const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const db = require('../../db');
const { tenantScope } = require('./_shared');

const router = express.Router();

const PY_BASE = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001';
const PY_KEY  = process.env.PYTHON_SERVICE_KEY || 'dev-key-change-me';
const SCOPES  = new Set(['all', 'document', 'folder']);

// ---------- conversation CRUD ---------------------------------------------

function hydrateConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function hydrateMessage(row) {
  if (!row) return null;
  let citations = [];
  if (row.citations_json) {
    try { citations = JSON.parse(row.citations_json); } catch { citations = []; }
  }
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    citations,
    has_evidence: row.has_evidence == null ? null : !!row.has_evidence,
    created_at: row.created_at,
  };
}

router.get('/ai/conversations', (req, res) => {
  const tenant = tenantScope(req);
  const rows = db.prepare(`
    SELECT c.*, (
      SELECT content FROM ai_messages m
      WHERE m.conversation_id = c.id AND m.role = 'user'
      ORDER BY m.id ASC LIMIT 1
    ) AS first_user_message,
    (SELECT COUNT(*) FROM ai_messages WHERE conversation_id = c.id) AS message_count
    FROM ai_conversations c
    WHERE c.user_id = ? AND c.tenant_id = ?
    ORDER BY c.updated_at DESC
    LIMIT 200
  `).all(req.session.user.id, tenant);
  res.json(rows.map((r) => ({
    ...hydrateConversation(r),
    first_user_message: r.first_user_message ?? null,
    message_count: r.message_count,
  })));
});

router.post('/ai/conversations', (req, res) => {
  const { title, scope_type, scope_id } = req.body ?? {};
  const scope = SCOPES.has(scope_type) ? scope_type : 'all';
  const sid = scope === 'all' ? null : (scope_id != null ? parseInt(scope_id, 10) : null);
  const info = db.prepare(`
    INSERT INTO ai_conversations (user_id, title, scope_type, scope_id, tenant_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.session.user.id,
    (typeof title === 'string' && title.trim()) ? title.trim().slice(0, 200) : 'New chat',
    scope,
    sid,
    tenantScope(req),
  );
  const row = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(hydrateConversation(row));
});

router.get('/ai/conversations/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare(
    'SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?',
  ).get(id, req.session.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const messages = db.prepare(
    'SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id ASC',
  ).all(id);
  res.json({
    conversation: hydrateConversation(row),
    messages: messages.map(hydrateMessage),
  });
});

router.patch('/ai/conversations/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare(
    'SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?',
  ).get(id, req.session.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const { title, scope_type, scope_id } = req.body ?? {};
  const sets = [];
  const values = [];
  if (typeof title === 'string' && title.trim()) {
    sets.push('title = ?'); values.push(title.trim().slice(0, 200));
  }
  if (scope_type && SCOPES.has(scope_type)) {
    sets.push('scope_type = ?'); values.push(scope_type);
    sets.push('scope_id = ?');
    values.push(scope_type === 'all' ? null : (scope_id != null ? parseInt(scope_id, 10) : null));
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no_fields' });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  db.prepare(`UPDATE ai_conversations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id);
  res.json(hydrateConversation(updated));
});

router.delete('/ai/conversations/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare(
    'SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?',
  ).get(id, req.session.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM ai_messages WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- streaming chat ------------------------------------------------

/**
 * POST /ai/chat/stream
 * Body: { conversation_id, question }
 *
 * Saves the user turn, opens an SSE to Python, pipes each `data: {...}`
 * frame straight through, and saves the assembled assistant turn when
 * `done` arrives. Citations are captured from the `citations` frame.
 */
router.post('/ai/chat/stream', (req, res) => {
  const { conversation_id, question } = req.body ?? {};
  const convoId = parseInt(conversation_id, 10);
  if (!Number.isFinite(convoId)) return res.status(400).json({ error: 'conversation_id required' });
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question required' });
  }

  const convo = db.prepare(
    'SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?',
  ).get(convoId, req.session.user.id);
  if (!convo) return res.status(404).json({ error: 'conversation_not_found' });

  // Persist the user message first so the UI stays consistent even if
  // streaming fails mid-way.
  db.prepare(
    'INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)',
  ).run(convoId, 'user', question.trim());

  // Assemble history. Bound to the last ~8 messages to stay under context.
  const history = db.prepare(
    `SELECT role, content FROM ai_messages
     WHERE conversation_id = ? AND id < (
       SELECT MAX(id) FROM ai_messages WHERE conversation_id = ?
     )
     ORDER BY id DESC LIMIT 8`,
  ).all(convoId, convoId).reverse();

  // Open the SSE to the client.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const pyUrl = new URL('/api/v1/docbrain/chat/stream', PY_BASE);
  const lib = pyUrl.protocol === 'https:' ? https : http;
  // DocBrain's vector store is currently single-tenant ('default') and
  // doesn't share the SPA's tenant_id namespace. Don't forward the SPA
  // tenant — it would cause retrieval to miss chunks under 'default'.
  // Sharing tenants with DocBrain is a separate migration.
  const body = JSON.stringify({
    question: question.trim(),
    history,
    ...(convo.scope_type === 'document' && convo.scope_id
      ? { document_id: convo.scope_id }
      : {}),
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

  const assembled = [];
  let citations = [];
  let hasEvidence = false;
  let carry = '';

  pyReq.on('response', (pyRes) => {
    if (pyRes.statusCode >= 400) {
      res.write(`data: ${JSON.stringify({ type: 'error', status: pyRes.statusCode })}\n\n`);
      res.end();
      return;
    }
    pyRes.setEncoding('utf-8');
    pyRes.on('data', (chunk) => {
      res.write(chunk);
      // Parse embedded events to build the assistant message for persistence.
      carry += chunk;
      let idx;
      while ((idx = carry.indexOf('\n\n')) !== -1) {
        const frame = carry.slice(0, idx);
        carry = carry.slice(idx + 2);
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'token' && typeof evt.text === 'string') assembled.push(evt.text);
          else if (evt.type === 'citations' && Array.isArray(evt.items)) citations = evt.items;
          else if (evt.type === 'done') hasEvidence = !!evt.has_evidence;
          else if (evt.type === 'no_evidence' && typeof evt.message === 'string') assembled.push(evt.message);
        } catch { /* non-JSON comment line */ }
      }
    });
    pyRes.on('end', () => {
      const answer = assembled.join('').trim();
      db.prepare(
        `INSERT INTO ai_messages (conversation_id, role, content, citations_json, has_evidence)
         VALUES (?, 'assistant', ?, ?, ?)`,
      ).run(
        convoId,
        answer,
        JSON.stringify(citations),
        hasEvidence ? 1 : 0,
      );
      // Auto-title an otherwise-unnamed chat from the first exchange.
      if (convo.title === 'New chat') {
        const firstLine = question.trim().split('\n')[0].slice(0, 80);
        db.prepare('UPDATE ai_conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(firstLine, convoId);
      } else {
        db.prepare('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convoId);
      }
      res.end();
    });
    pyRes.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });
  });
  pyReq.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  });
  req.on('close', () => {
    // Client disconnected (e.g. clicked Stop). Abort the upstream request.
    try { pyReq.destroy(); } catch { /* ignore */ }
  });

  pyReq.write(body);
  pyReq.end();
});

/**
 * POST /ai/agent/stream — same wire shape as /ai/chat/stream but proxies
 * to the Python agent endpoint (/api/v1/docbrain/agent/stream). The agent
 * decides which tools to call (find_documents, list_expiring, etc). We
 * additionally capture tool_call + tool_result frames so the persisted
 * assistant turn carries the action trail for audit.
 */
router.post('/ai/agent/stream', (req, res) => {
  const { conversation_id, question } = req.body ?? {};
  const convoId = parseInt(conversation_id, 10);
  if (!Number.isFinite(convoId)) return res.status(400).json({ error: 'conversation_id required' });
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question required' });
  }

  const convo = db.prepare(
    'SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?',
  ).get(convoId, req.session.user.id);
  if (!convo) return res.status(404).json({ error: 'conversation_not_found' });

  db.prepare(
    'INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)',
  ).run(convoId, 'user', question.trim());

  const history = db.prepare(
    `SELECT role, content FROM ai_messages
     WHERE conversation_id = ? AND id < (
       SELECT MAX(id) FROM ai_messages WHERE conversation_id = ?
     )
     ORDER BY id DESC LIMIT 8`,
  ).all(convoId, convoId).reverse();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const pyUrl = new URL('/api/v1/docbrain/agent/stream', PY_BASE);
  const lib = pyUrl.protocol === 'https:' ? https : http;
  const body = JSON.stringify({ question: question.trim(), history });
  const pyReq = lib.request(pyUrl, {
    method: 'POST',
    headers: {
      'X-API-Key': PY_KEY,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Content-Length': Buffer.byteLength(body),
    },
  });

  const assembled = [];
  const toolTrail = [];
  let carry = '';

  pyReq.on('response', (pyRes) => {
    if (pyRes.statusCode >= 400) {
      res.write(`data: ${JSON.stringify({ type: 'error', status: pyRes.statusCode })}\n\n`);
      res.end();
      return;
    }
    pyRes.setEncoding('utf-8');
    pyRes.on('data', (chunk) => {
      res.write(chunk);
      carry += chunk;
      let idx;
      while ((idx = carry.indexOf('\n\n')) !== -1) {
        const frame = carry.slice(0, idx);
        carry = carry.slice(idx + 2);
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.type === 'token' && typeof evt.text === 'string') assembled.push(evt.text);
          else if (evt.type === 'tool_call') toolTrail.push({ call: { name: evt.name, arguments: evt.arguments } });
          else if (evt.type === 'tool_result') toolTrail.push({ result: { name: evt.name, result: evt.result } });
        } catch { /* ignore parse noise */ }
      }
    });
    pyRes.on('end', () => {
      const answer = assembled.join('').trim();
      db.prepare(
        `INSERT INTO ai_messages (conversation_id, role, content, citations_json, has_evidence)
         VALUES (?, 'assistant', ?, ?, ?)`,
      ).run(
        convoId,
        answer,
        JSON.stringify(toolTrail),
        1,
      );
      if (convo.title === 'New chat') {
        const firstLine = question.trim().split('\n')[0].slice(0, 80);
        db.prepare('UPDATE ai_conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(firstLine, convoId);
      } else {
        db.prepare('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convoId);
      }
      res.end();
    });
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

module.exports = router;

'use strict';

/**
 * SPA-API for document annotations (Viewer v2).
 *
 * Endpoints:
 *   GET    /spa/api/documents/:id/annotations          — list all annotations
 *   POST   /spa/api/documents/:id/annotations          — create annotation
 *   PATCH  /spa/api/documents/:id/annotations/:annId   — update annotation
 *   DELETE /spa/api/documents/:id/annotations/:annId   — delete annotation
 *
 * RBAC: each tool type is gated by the roles stored in
 * tenant_config namespace='viewer' key='tools.<type>.roles'.
 * Default allowlist when the config key is missing: Doc Admin, Maker, Checker.
 *
 * The SSR route at routes/annotations.js (mounted at /annotations/:docId) is
 * left untouched for backward compatibility.
 */

const express = require('express');
const db = require('../../db');
const { requireAuthJson, tenantScope } = require('./_shared');

const router = express.Router();

// ── constants ─────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(['highlight', 'comment', 'stamp', 'signature', 'redact']);
const DEFAULT_ALLOWED_ROLES = new Set(['Doc Admin', 'Maker', 'Checker']);

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the allowed roles for a tool from tenant_config.
 * Falls back to DEFAULT_ALLOWED_ROLES if the key is absent or unparseable.
 * @param {string} tenantId
 * @param {string} toolType  — e.g. 'highlight'
 * @returns {Set<string>}
 */
function resolveToolRoles(tenantId, toolType) {
  try {
    const row = db.prepare(
      `SELECT value FROM tenant_config
       WHERE tenant_id=? AND namespace='viewer' AND key=?`,
    ).get(tenantId, `tools.${toolType}.roles`);
    if (!row) return DEFAULT_ALLOWED_ROLES;
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ALLOWED_ROLES;
    return new Set(parsed);
  } catch {
    return DEFAULT_ALLOWED_ROLES;
  }
}

/**
 * Verify the document exists (and belongs to this tenant if applicable).
 * Returns the row or null.
 * @param {number} docId
 * @param {string} _tenantId  — reserved for future tenant-scoping
 */
function resolveDocument(docId, _tenantId) {
  return db.prepare('SELECT id FROM documents WHERE id=?').get(docId) ?? null;
}

function writeAudit({ userId, action, entityId, details, tenantId }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
       VALUES (?, ?, 'annotation', ?, ?, ?)`,
    ).run(userId, action, String(entityId), JSON.stringify(details), tenantId);
  } catch {
    // audit failure must never block the response
  }
}

// ── GET /spa/api/documents/:id/annotations ────────────────────────────────────

router.get('/documents/:id/annotations', requireAuthJson, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  if (!Number.isFinite(docId) || docId <= 0) {
    return res.status(400).json({ error: 'invalid document id' });
  }

  const tenantId = tenantScope(req);
  if (!resolveDocument(docId, tenantId)) {
    return res.status(404).json({ error: 'document not found' });
  }

  const rows = db.prepare(
    `SELECT a.id, a.doc_id, a.user_id, a.page, a.kind AS type,
            a.x, a.y, a.w, a.h, a.text AS payload_text,
            a.color, a.created_at, u.username
     FROM annotations a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.doc_id = ?
     ORDER BY a.id`,
  ).all(docId);

  return res.json(rows);
});

// ── POST /spa/api/documents/:id/annotations ───────────────────────────────────

router.post('/documents/:id/annotations', requireAuthJson, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  if (!Number.isFinite(docId) || docId <= 0) {
    return res.status(400).json({ error: 'invalid document id' });
  }

  const user = req.session.user;
  const tenantId = tenantScope(req);

  if (!resolveDocument(docId, tenantId)) {
    return res.status(404).json({ error: 'document not found' });
  }

  const { type, page, bbox, payload, color } = req.body ?? {};

  // Validate type
  if (!type || !VALID_TYPES.has(type)) {
    return res.status(400).json({ error: `type must be one of: ${[...VALID_TYPES].join(', ')}` });
  }

  // RBAC: check tool-level role allowlist
  const allowedRoles = resolveToolRoles(tenantId, type);
  if (!allowedRoles.has(user.role)) {
    return res.status(403).json({ error: 'forbidden', detail: `role '${user.role}' may not use tool '${type}'` });
  }

  // Validate bbox
  if (!bbox || typeof bbox !== 'object') {
    return res.status(400).json({ error: 'bbox is required: { x, y, w, h }' });
  }
  const { x, y, w, h } = bbox;
  for (const [field, val] of [['x', x], ['y', y], ['w', w], ['h', h]]) {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return res.status(400).json({ error: `bbox.${field} must be a finite number` });
    }
  }

  const pageNum = Number.isInteger(page) && page >= 0 ? page : 0;

  // Serialise payload (text for comment/highlight, stampId for stamp, etc.)
  const payloadText =
    payload !== null && payload !== undefined ? String(payload) : '';
  const colorStr = typeof color === 'string' ? color.slice(0, 32) : '';

  const info = db.prepare(
    `INSERT INTO annotations (doc_id, user_id, page, kind, x, y, w, h, text, color)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(docId, user.id, pageNum, type, x, y, w, h, payloadText, colorStr);

  writeAudit({
    userId: user.id,
    action: 'ANNOTATION_CREATED',
    entityId: info.lastInsertRowid,
    details: { doc_id: docId, type, page: pageNum },
    tenantId,
  });

  const created = db.prepare('SELECT * FROM annotations WHERE id=?').get(info.lastInsertRowid);
  return res.status(201).json(created);
});

// ── PATCH /spa/api/documents/:id/annotations/:annId ──────────────────────────

router.patch('/documents/:id/annotations/:annId', requireAuthJson, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const annId = parseInt(req.params.annId, 10);
  if (!Number.isFinite(docId) || docId <= 0 || !Number.isFinite(annId) || annId <= 0) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const user = req.session.user;
  const tenantId = tenantScope(req);

  const existing = db.prepare(
    'SELECT * FROM annotations WHERE id=? AND doc_id=?',
  ).get(annId, docId);
  if (!existing) return res.status(404).json({ error: 'annotation not found' });

  // Only the owner or Doc Admin may update
  if (existing.user_id !== user.id && user.role !== 'Doc Admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { payload, color, page, bbox } = req.body ?? {};

  const newPayload = payload !== undefined ? String(payload) : existing.text;
  const newColor   = typeof color === 'string' ? color.slice(0, 32) : existing.color;
  const newPage    = Number.isInteger(page) && page >= 0 ? page : existing.page;
  const newX       = typeof bbox?.x === 'number' ? bbox.x : existing.x;
  const newY       = typeof bbox?.y === 'number' ? bbox.y : existing.y;
  const newW       = typeof bbox?.w === 'number' ? bbox.w : existing.w;
  const newH       = typeof bbox?.h === 'number' ? bbox.h : existing.h;

  db.prepare(
    `UPDATE annotations SET page=?, x=?, y=?, w=?, h=?, text=?, color=? WHERE id=?`,
  ).run(newPage, newX, newY, newW, newH, newPayload, newColor, annId);

  writeAudit({
    userId: user.id,
    action: 'ANNOTATION_UPDATED',
    entityId: annId,
    details: { doc_id: docId },
    tenantId,
  });

  const updated = db.prepare('SELECT * FROM annotations WHERE id=?').get(annId);
  return res.json(updated);
});

// ── DELETE /spa/api/documents/:id/annotations/:annId ─────────────────────────

router.delete('/documents/:id/annotations/:annId', requireAuthJson, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const annId = parseInt(req.params.annId, 10);
  if (!Number.isFinite(docId) || docId <= 0 || !Number.isFinite(annId) || annId <= 0) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const user = req.session.user;
  const tenantId = tenantScope(req);

  const existing = db.prepare(
    'SELECT * FROM annotations WHERE id=? AND doc_id=?',
  ).get(annId, docId);
  if (!existing) return res.status(404).json({ error: 'annotation not found' });

  if (existing.user_id !== user.id && user.role !== 'Doc Admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  db.prepare('DELETE FROM annotations WHERE id=?').run(annId);

  writeAudit({
    userId: user.id,
    action: 'ANNOTATION_DELETED',
    entityId: annId,
    details: { doc_id: docId },
    tenantId,
  });

  return res.json({ ok: true });
});

module.exports = router;

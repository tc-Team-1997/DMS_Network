/**
 * Legal Holds admin API — Wave B Retention + WORM Admin (F#30-31).
 *
 * A legal hold pins a document so it is excluded from retention sweep.
 * Only Doc Admin may apply or release holds. Every mutation is audited.
 *
 * Endpoints:
 *   GET    /spa/api/admin/legal-holds          — list all holds for tenant
 *   POST   /spa/api/admin/legal-holds          — apply a legal hold
 *   DELETE /spa/api/admin/legal-holds/:id      — release a legal hold
 *
 * Auth: requireNamespacePermJson('retention') → Doc Admin only.
 * Reason field: min 20 chars for apply; min 20 chars for release.
 *
 * DB: legal_holds table created in migration 0036.
 * Node-side legal_holds mirrors the Python-service legal_holds table conceptually
 * but is a separate Node SQLite table. They share the same doc_id space but
 * the Node table is the authoritative source for the SPA admin surface.
 */

'use strict';

const express = require('express');
const db = require('../../db');
const { requireNamespacePermJson, tenantScope } = require('./_shared');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write an audit_log row. Swallows errors so audit failure cannot block
 * the primary response.
 */
function writeAudit({ userId, action, entityId, details, tenantId }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId, action, 'legal_hold', String(entityId ?? ''),
      typeof details === 'string' ? details : JSON.stringify(details),
      tenantId || 'nbe',
    );
  } catch (auditErr) {
    console.error('[legal-holds] audit_log write failed:', auditErr.message);
  }
}

// ---------------------------------------------------------------------------
// GET /spa/api/admin/legal-holds
// ---------------------------------------------------------------------------

/**
 * List all legal holds for the tenant, including resolved (released) ones.
 * Query params:
 *   active_only=true  — only return holds where released_at IS NULL
 *   doc_id=<n>        — filter by document
 *   limit=<n>         — default 100, max 500
 */
router.get(
  '/admin/legal-holds',
  requireNamespacePermJson('retention'),
  (req, res) => {
    const tenant = tenantScope(req);
    const activeOnly = req.query.active_only === 'true';
    const docId = req.query.doc_id ? parseInt(String(req.query.doc_id), 10) : null;
    const limit = Math.min(parseInt(String(req.query.limit ?? 100), 10) || 100, 500);

    let sql = `
      SELECT lh.id, lh.doc_id, lh.applied_by, lh.applied_at,
             lh.released_by, lh.released_at, lh.reason, lh.tenant_id,
             d.original_name AS document_name, d.doc_type
      FROM legal_holds lh
      LEFT JOIN documents d ON d.id = lh.doc_id
      WHERE lh.tenant_id = ?
    `;
    const params = [tenant];

    if (activeOnly) {
      sql += ' AND lh.released_at IS NULL';
    }
    if (docId !== null && Number.isFinite(docId)) {
      sql += ' AND lh.doc_id = ?';
      params.push(docId);
    }
    sql += ' ORDER BY lh.applied_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    res.json({ legal_holds: rows, total: rows.length });
  },
);

// ---------------------------------------------------------------------------
// POST /spa/api/admin/legal-holds
// ---------------------------------------------------------------------------

/**
 * Apply a legal hold to a document.
 * Body: { doc_id: number, reason: string (≥20 chars) }
 */
router.post(
  '/admin/legal-holds',
  requireNamespacePermJson('retention'),
  (req, res) => {
    const tenant = tenantScope(req);
    const userId = req.session.user.id;
    const username = req.session.user.username || String(userId);

    const { doc_id, reason } = req.body || {};

    if (!doc_id || !Number.isFinite(Number(doc_id))) {
      return res.status(400).json({ error: 'doc_id is required and must be a positive integer' });
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 20) {
      return res.status(400).json({ error: 'reason must be at least 20 characters' });
    }

    const docIdNum = Number(doc_id);

    // Verify document exists and belongs to this tenant.
    const doc = db.prepare(
      'SELECT id, original_name FROM documents WHERE id = ? AND tenant_id = ?'
    ).get(docIdNum, tenant);
    if (!doc) {
      return res.status(404).json({ error: 'document_not_found' });
    }

    // Check for an existing active hold on this document.
    const existing = db.prepare(
      'SELECT id FROM legal_holds WHERE doc_id = ? AND tenant_id = ? AND released_at IS NULL'
    ).get(docIdNum, tenant);
    if (existing) {
      return res.status(409).json({
        error: 'document_already_on_hold',
        hold_id: existing.id,
        detail: 'This document already has an active legal hold. Release it first.',
      });
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO legal_holds (doc_id, applied_by, applied_at, reason, tenant_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(docIdNum, username, now, reason.trim(), tenant);

    writeAudit({
      userId,
      action: 'LEGAL_HOLD_APPLIED',
      entityId: result.lastInsertRowid,
      details: { doc_id: docIdNum, reason: reason.trim().slice(0, 120) },
      tenantId: tenant,
    });

    res.status(201).json({
      id: result.lastInsertRowid,
      doc_id: docIdNum,
      applied_by: username,
      applied_at: now,
      released_by: null,
      released_at: null,
      reason: reason.trim(),
      tenant_id: tenant,
    });
  },
);

// ---------------------------------------------------------------------------
// DELETE /spa/api/admin/legal-holds/:id
// ---------------------------------------------------------------------------

/**
 * Release a legal hold by id.
 * Body: { reason: string (≥20 chars) }
 */
router.delete(
  '/admin/legal-holds/:id',
  requireNamespacePermJson('retention'),
  (req, res) => {
    const tenant = tenantScope(req);
    const userId = req.session.user.id;
    const username = req.session.user.username || String(userId);
    const holdId = parseInt(String(req.params.id), 10);

    if (!Number.isFinite(holdId) || holdId < 1) {
      return res.status(400).json({ error: 'invalid hold id' });
    }

    const { reason } = req.body || {};
    if (!reason || typeof reason !== 'string' || reason.trim().length < 20) {
      return res.status(400).json({ error: 'reason must be at least 20 characters' });
    }

    const hold = db.prepare(
      'SELECT * FROM legal_holds WHERE id = ? AND tenant_id = ?'
    ).get(holdId, tenant);
    if (!hold) {
      return res.status(404).json({ error: 'hold_not_found' });
    }
    if (hold.released_at !== null) {
      return res.status(409).json({
        error: 'hold_already_released',
        released_at: hold.released_at,
        released_by: hold.released_by,
      });
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE legal_holds SET released_by = ?, released_at = ?, reason = reason || ? WHERE id = ?'
    ).run(username, now, ` | Released: ${reason.trim().slice(0, 80)}`, holdId);

    writeAudit({
      userId,
      action: 'LEGAL_HOLD_RELEASED',
      entityId: holdId,
      details: { doc_id: hold.doc_id, reason: reason.trim().slice(0, 120) },
      tenantId: tenant,
    });

    const updated = db.prepare('SELECT * FROM legal_holds WHERE id = ?').get(holdId);
    res.json(updated);
  },
);

module.exports = router;

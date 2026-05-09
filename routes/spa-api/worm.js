/**
 * WORM retention-lock — Node SPA mirror of the Python /api/v1/documents/{id}/worm/*
 * and /api/v1/worm/verify-batch surface.
 *
 * Every route:
 *   1. Requires a valid session (enforced globally in routes/spa-api.js before
 *      this router is invoked — no per-handler requireAuthJson needed).
 *   2. Is guarded by one of two RBAC permission slugs:
 *        worm:admin — Doc Admin only (lock / unlock / verify-batch)
 *        worm:read  — Viewer, Maker, Checker, Doc Admin (status)
 *   3. Injects X-API-Key server-side via pyCall(); the key is NEVER returned
 *      to the browser.
 *   4. Writes an audit_log row for every mutation (try/catch so audit failure
 *      cannot roll back the proxied write that already succeeded on Python).
 *   5. PII: file paths are not logged; only document IDs and usernames appear.
 *
 * Python base paths:
 *   POST   /api/v1/documents/{id}/worm/lock
 *   POST   /api/v1/documents/{id}/worm/unlock
 *   GET    /api/v1/documents/{id}/worm/status
 *   POST   /api/v1/worm/verify-batch
 *
 * Mounted at: /spa/api/worm/*  (via routes/spa-api.js)
 *
 * Contract: docs/contracts/worm-retention-lock.md §4 + §5
 */

'use strict';

const express = require('express');
const db = require('../../db');
const { pyCall, requirePermJson, tenantScope } = require('./_shared');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORM_ADMIN_PERM = 'worm:admin';
const WORM_READ_PERM  = 'worm:read';

const VALID_UNLOCK_REASONS = new Set([
  'legal_hold_released',
  'retention_expired',
  'error_correction',
]);

// ---------------------------------------------------------------------------
// Audit helper (mirrors documents.js inline pattern)
// ---------------------------------------------------------------------------

/**
 * Write a row to the Node-side audit_log table.
 * Never throws — audit failure must not block the primary response.
 *
 * @param {object} opts
 * @param {number|string} opts.userId
 * @param {string}        opts.action
 * @param {string}        opts.entity
 * @param {number|string} opts.entityId
 * @param {object|string} opts.details
 * @param {string}        [opts.tenantId]
 */
function writeAudit({ userId, action, entity, entityId, details, tenantId }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      action,
      entity,
      String(entityId),
      typeof details === 'string' ? details : JSON.stringify(details),
      tenantId || 'nbe',
    );
  } catch (auditErr) {
    // Log to stderr but swallow so the primary response is unaffected.
    console.error('[worm] audit_log write failed:', auditErr.message);
  }
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

/**
 * Parse a positive integer path segment; returns null on invalid input.
 * @param {string} raw
 * @returns {number|null}
 */
function parseDocId(raw) {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// POST /spa/api/worm/:documentId/lock
// ---------------------------------------------------------------------------

router.post(
  '/worm/:documentId/lock',
  requirePermJson(WORM_ADMIN_PERM),
  async (req, res) => {
    const documentId = parseDocId(req.params.documentId);
    if (documentId === null) {
      return res.status(400).json({ error: 'invalid_document_id' });
    }

    const { unlock_after_days, reason } = req.body || {};
    if (
      typeof unlock_after_days !== 'number' ||
      !Number.isFinite(unlock_after_days) ||
      unlock_after_days < 1 ||
      unlock_after_days > 36525
    ) {
      return res.status(400).json({
        error: 'validation_error',
        detail: 'unlock_after_days must be an integer in [1, 36525]',
      });
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({
        error: 'validation_error',
        detail: 'reason is required',
      });
    }

    try {
      const data = await pyCall(
        `/api/v1/documents/${documentId}/worm/lock`,
        { method: 'POST', body: { unlock_after_days, reason: reason.trim() } },
      );

      writeAudit({
        userId:   req.session.user.id,
        action:   'WORM_LOCKED',
        entity:   'document',
        entityId: documentId,
        details:  { unlock_after_days, reason: reason.trim() },
        tenantId: tenantScope(req),
      });

      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json(err.data || { error: 'upstream_error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /spa/api/worm/:documentId/unlock
// ---------------------------------------------------------------------------

router.post(
  '/worm/:documentId/unlock',
  requirePermJson(WORM_ADMIN_PERM),
  async (req, res) => {
    const documentId = parseDocId(req.params.documentId);
    if (documentId === null) {
      return res.status(400).json({ error: 'invalid_document_id' });
    }

    const { reason, approver_notes } = req.body || {};
    if (!reason || !VALID_UNLOCK_REASONS.has(reason)) {
      return res.status(400).json({
        error: 'validation_error',
        detail: `reason must be one of: ${[...VALID_UNLOCK_REASONS].join(', ')}`,
      });
    }

    try {
      const data = await pyCall(
        `/api/v1/documents/${documentId}/worm/unlock`,
        {
          method: 'POST',
          body: {
            reason,
            approver_notes: typeof approver_notes === 'string' ? approver_notes.slice(0, 1024) : '',
          },
        },
      );

      writeAudit({
        userId:   req.session.user.id,
        action:   'WORM_UNLOCKED',
        entity:   'document',
        entityId: documentId,
        details:  { reason, approver_notes_len: (approver_notes || '').length },
        tenantId: tenantScope(req),
      });

      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json(err.data || { error: 'upstream_error' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /spa/api/worm/:documentId/status
// ---------------------------------------------------------------------------

router.get(
  '/worm/:documentId/status',
  requirePermJson(WORM_READ_PERM),
  async (req, res) => {
    const documentId = parseDocId(req.params.documentId);
    if (documentId === null) {
      return res.status(400).json({ error: 'invalid_document_id' });
    }

    try {
      const data = await pyCall(
        `/api/v1/documents/${documentId}/worm/status`,
        { method: 'GET' },
      );
      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json(err.data || { error: 'upstream_error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /spa/api/worm/verify-batch
// ---------------------------------------------------------------------------

router.post(
  '/worm/verify-batch',
  requirePermJson(WORM_ADMIN_PERM),
  async (req, res) => {
    try {
      const data = await pyCall(
        '/api/v1/worm/verify-batch',
        { method: 'POST', body: {} },
      );

      writeAudit({
        userId:   req.session.user.id,
        action:   'WORM_VERIFY_BATCH',
        entity:   'worm',
        entityId: 0,
        details:  { examined: data.examined, tampered: data.tampered },
        tenantId: tenantScope(req),
      });

      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json(err.data || { error: 'upstream_error' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /spa/api/admin/worm/locked
// ---------------------------------------------------------------------------

/**
 * List all WORM-locked documents for the tenant.
 * Returns id, original_name, doc_type, worm_locked_at, worm_unlock_after,
 * days_remaining, sha256_at_lock (prefix only, not full hash for PII safety).
 * Query params: limit (default 200, max 500).
 */
router.get(
  '/admin/worm/locked',
  requirePermJson(WORM_ADMIN_PERM),
  (req, res) => {
    const tenant = tenantScope(req);
    const limit = Math.min(parseInt(String(req.query.limit ?? 200), 10) || 200, 500);

    const rows = db.prepare(`
      SELECT id, original_name, doc_type, worm_locked_at, worm_unlock_after, sha256_at_lock
      FROM documents
      WHERE worm_locked_at IS NOT NULL
        AND (tenant_id = ? OR tenant_id IS NULL)
      ORDER BY worm_locked_at DESC
      LIMIT ?
    `).all(tenant, limit);

    const now = Date.now();
    const result = rows.map((r) => {
      const unlockMs = r.worm_unlock_after ? new Date(r.worm_unlock_after).getTime() : null;
      const days_remaining = unlockMs !== null
        ? Math.max(0, Math.ceil((unlockMs - now) / 86400000))
        : null;
      return {
        id:               r.id,
        original_name:    r.original_name,
        doc_type:         r.doc_type,
        worm_locked_at:   r.worm_locked_at,
        worm_unlock_after: r.worm_unlock_after,
        days_remaining,
        // Only expose first 8 chars of hash — enough to correlate in audit,
        // not enough to reconstruct or reveal full forensic baseline.
        sha256_prefix:    r.sha256_at_lock ? r.sha256_at_lock.slice(0, 8) + '…' : null,
      };
    });

    res.json({ locked_documents: result, total: result.length });
  },
);

// ---------------------------------------------------------------------------
// POST /spa/api/admin/worm/extend
// ---------------------------------------------------------------------------

/**
 * Extend the WORM lock period for a document. Admin can EXTEND, never SHORTEN.
 * Body: { document_id: number, extend_by_days: number (≥1), reason: string (≥20 chars) }
 * Proxies to POST /api/v1/documents/{id}/worm/extend on the Python service.
 * Writes a local audit row regardless of Python-side audit.
 */
router.post(
  '/admin/worm/extend',
  requirePermJson(WORM_ADMIN_PERM),
  async (req, res) => {
    const tenant = tenantScope(req);
    const userId = req.session.user.id;
    const { document_id, extend_by_days, reason } = req.body || {};

    const docId = parseDocId(document_id);
    if (docId === null) {
      return res.status(400).json({ error: 'validation_error', detail: 'document_id must be a positive integer' });
    }

    const extDays = Number(extend_by_days);
    if (!Number.isFinite(extDays) || extDays < 1 || !Number.isInteger(extDays)) {
      return res.status(400).json({ error: 'validation_error', detail: 'extend_by_days must be a positive integer' });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 20) {
      return res.status(400).json({ error: 'validation_error', detail: 'reason must be at least 20 characters' });
    }

    try {
      const data = await pyCall(
        `/api/v1/documents/${docId}/worm/extend`,
        { method: 'POST', body: { extend_by_days: extDays, reason: reason.trim() } },
      );

      writeAudit({
        userId,
        action:   'WORM_EXTENDED',
        entity:   'document',
        entityId: docId,
        details:  {
          extend_by_days: extDays,
          reason: reason.trim().slice(0, 120),
          new_unlock_after: data.new_unlock_after,
        },
        tenantId: tenant,
      });

      return res.json(data);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json(err.data || { error: 'upstream_error' });
    }
  },
);

module.exports = router;

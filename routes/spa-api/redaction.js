'use strict';

/**
 * SPA mirror for document-redaction endpoints (BHU-46).
 *
 * Proxies to Python service /api/v1/documents/{id}/redact and
 * /api/v1/documents/{id}/redaction-status with:
 *   - session authentication
 *   - RBAC gating (documents:redact / documents:read)
 *   - input validation of regions array
 *   - audit logging with masked details (page numbers + count, NOT coordinates)
 *
 * Mounted at /spa/api (see routes/spa-api.js).
 * Do NOT touch routes/spa-api.js — team lead handles that.
 */

const express = require('express');
const db = require('../../db');
const { pyCall, requireAuthJson, requirePermJson, tenantScope } = require('./_shared');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_REASONS = new Set([
  'pii',
  'financial-secret',
  'commercial-confidential',
  'legal-hold',
  'other',
]);

const MAX_REGIONS = 50;
const MAX_COORD = 10000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write a masked audit record for DOCUMENT_REDACTED.
 * We log page numbers and region count but NOT region coordinates,
 * because coordinates could reveal information about what was redacted.
 */
function writeRedactionAudit({ userId, documentId, regionCount, pages, reason, tenantId }) {
  const maskedDetail = JSON.stringify({
    region_count: regionCount,
    pages_affected: pages,
    reason,
  });
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      'DOCUMENT_REDACTED',
      'document',
      String(documentId),
      maskedDetail,
      tenantId || 'nbe',
    );
  } catch (err) {
    // Non-fatal: audit failure must not block the redaction response
    console.error('[redaction audit]', err.message);
  }
}

/**
 * Validate a single region object.
 * Returns an error string or null if valid.
 */
function validateRegion(r, index) {
  if (r === null || typeof r !== 'object') {
    return `Region ${index} is not an object`;
  }
  const { page, x, y, w, h } = r;
  if (!Number.isInteger(page) || page < 0) {
    return `Region ${index}: page must be a non-negative integer`;
  }
  for (const [field, val] of [['x', x], ['y', y], ['w', w], ['h', h]]) {
    if (typeof val !== 'number' || val < 0 || val > MAX_COORD) {
      return `Region ${index}: ${field} must be a number in [0, ${MAX_COORD}]`;
    }
  }
  if (w <= 0) return `Region ${index}: w must be positive`;
  if (h <= 0) return `Region ${index}: h must be positive`;
  if (r.reason !== undefined && !VALID_REASONS.has(r.reason)) {
    return `Region ${index}: reason "${r.reason}" is not valid`;
  }
  return null;
}

/**
 * Validate the full regions array and top-level reason.
 * Returns { ok: true } or { ok: false, error: string }.
 */
function validateRedactBody(body) {
  const { regions, reason } = body || {};

  if (!Array.isArray(regions) || regions.length === 0) {
    return { ok: false, error: 'regions must be a non-empty array' };
  }
  if (regions.length > MAX_REGIONS) {
    return { ok: false, error: `regions array exceeds maximum of ${MAX_REGIONS}` };
  }
  if (!reason || !VALID_REASONS.has(reason)) {
    return { ok: false, error: `reason must be one of: ${[...VALID_REASONS].join(', ')}` };
  }
  for (let i = 0; i < regions.length; i++) {
    const err = validateRegion(regions[i], i);
    if (err) return { ok: false, error: err };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// POST /spa/api/documents/:id/redact
// ---------------------------------------------------------------------------
router.post(
  '/documents/:id/redact',
  requireAuthJson,
  requirePermJson('documents:redact'),
  async (req, res) => {
    const docId = parseInt(req.params.id, 10);
    if (!Number.isFinite(docId) || docId <= 0) {
      return res.status(400).json({ error: 'invalid document id' });
    }

    const validation = validateRedactBody(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const { regions, reason, preserve_metadata, lock_original } = req.body;
    const user = req.session.user;
    const tenantId = tenantScope(req);

    let pyResult;
    try {
      pyResult = await pyCall(`/api/v1/documents/${docId}/redact`, {
        method: 'POST',
        body: {
          regions,
          reason,
          preserve_metadata: preserve_metadata === true,
          lock_original: lock_original === true,
        },
      });
    } catch (err) {
      const status = err.status || 502;
      const detail = err.data?.detail || err.message || 'redaction failed';
      return res.status(status).json({ error: detail });
    }

    // Audit with masked details (page numbers + count only, NOT coordinates)
    const pages = [...new Set(regions.map((r) => r.page))].sort((a, b) => a - b);
    writeRedactionAudit({
      userId: user.id,
      documentId: docId,
      regionCount: regions.length,
      pages,
      reason,
      tenantId,
    });

    return res.status(201).json(pyResult);
  },
);

// ---------------------------------------------------------------------------
// GET /spa/api/documents/:id/redaction-status
// ---------------------------------------------------------------------------
router.get(
  '/documents/:id/redaction-status',
  requireAuthJson,
  requirePermJson('documents:read'),
  async (req, res) => {
    const docId = parseInt(req.params.id, 10);
    if (!Number.isFinite(docId) || docId <= 0) {
      return res.status(400).json({ error: 'invalid document id' });
    }

    let pyResult;
    try {
      pyResult = await pyCall(`/api/v1/documents/${docId}/redaction-status`, {
        method: 'GET',
      });
    } catch (err) {
      const status = err.status || 502;
      const detail = err.data?.detail || err.message || 'status query failed';
      return res.status(status).json({ error: detail });
    }

    return res.status(200).json(pyResult);
  },
);

module.exports = router;

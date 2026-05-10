/**
 * routes/spa-api/sync.js — Offline Sync Queue replay surface (BHU-57).
 *
 * Mounted at /spa/api (see routes/spa-api.js).  All routes require a
 * logged-in session (requireAuthJson is applied upstream in spa-api.js).
 *
 * Endpoints:
 *   POST /spa/api/sync/replay
 *     Accepts { outbox_entries: [{ idempotency_key, payload }] } and replays
 *     each entry through the existing POST /spa/api/documents handler logic.
 *     Returns { accepted: [], deduped: [], failed: [] }.
 *
 *   GET /spa/api/sync/status
 *     Returns the calling user's sync stats for the last 7 days:
 *     { replayed, deduped, failed_count, last_sync_at }.
 *
 * RBAC: uses the existing 'capture' permission (same as POST /spa/api/documents).
 * No new permission slug is required — sync replay is semantically identical to
 * a live document upload.  The route enforces self-only scope (user_id from
 * session, not request body).
 *
 * Audit: every replay attempt writes OFFLINE_SYNC_REPLAY to audit_log with
 * { accepted_count, deduped_count, failed_count }. Raw payloads are never
 * logged.
 */
'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('../../db');
const rbac    = require('../../services/rbac');
const {
  getIdempotency,
  storeIdempotency,
  sha256,
} = require('../../services/idempotency');
const { tenantScope } = require('./_shared');
const { buildPolicyDecision } = require('../../services/audit-policy');
const { runOcr }      = require('../../services/ocr');

const router = express.Router();

// UUID v4 regex for validating Idempotency-Key values.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Write a row to audit_log (same pattern as documents.js). */
function writeAudit({ userId, action, entity, entityId, details, tenantId, policyDecision = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id, policy_decision)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    action,
    entity,
    entityId ?? null,
    typeof details === 'string' ? details : JSON.stringify(details),
    tenantId || 'nbe',
    policyDecision !== null ? JSON.stringify(policyDecision) : null
  );
}

// Columns mirrored from metadata to flat columns (same list as documents.js).
const MIRRORED_COLUMNS = [
  'customer_cid', 'customer_name', 'doc_number',
  'dob', 'issue_date', 'expiry_date', 'issuing_authority',
];

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

/**
 * Replay a single outbox entry payload as a DB insert (no file — outbox
 * entries from the SPA carry JSON metadata only; file blobs live in
 * IndexedDB client-side and are not part of the server replay path in Wave A).
 *
 * Returns { id, status, idempotency_key } on success.
 * Throws on failure.
 */
function replayEntry(outboxPayload, userId, tenantId) {
  const body     = outboxPayload ?? {};
  const metadata = (() => {
    if (typeof body.metadata_json === 'string' && body.metadata_json.trim()) {
      try { return JSON.parse(body.metadata_json); } catch { throw new Error('invalid_metadata_json'); }
    }
    return {};
  })();

  // Merge legacy flat fields into metadata (same logic as documents.js).
  for (const col of MIRRORED_COLUMNS) {
    if (metadata[col] == null && typeof body[col] === 'string' && body[col].trim()) {
      metadata[col] = body[col].trim();
    }
  }

  const flat = {};
  for (const col of MIRRORED_COLUMNS) {
    const v = metadata[col];
    flat[col] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  // For Wave A (JSON-only replay), the file is unavailable server-side.
  // We record a placeholder filename and zero size so the document row is
  // complete.  Wave B will extend this to carry the actual file blob.
  const placeholderFilename = `sync-${Date.now()}-${userId}.pending`;

  const info = db.prepare(
    `INSERT INTO documents
       (filename, original_name, doc_type, customer_cid, customer_name,
        doc_number, dob, issue_date, expiry_date, issuing_authority,
        branch, folder_id, status, version, size, mime_type, notes,
        uploaded_by, tenant_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Valid', 'v1.0', ?, ?, ?, ?, ?, ?)`
  ).run(
    placeholderFilename,
    body.original_name || 'offline-capture',
    body.doc_type || null,
    flat.customer_cid, flat.customer_name, flat.doc_number,
    flat.dob, flat.issue_date, flat.expiry_date, flat.issuing_authority,
    body.branch || null,
    body.folder_id ? parseInt(body.folder_id, 10) : null,
    0,                        // size unknown in Wave A
    body.mime_type || null,
    body.notes || null,
    userId, tenantId,
    JSON.stringify(metadata)
  );

  const docId = info.lastInsertRowid;

  // Best-effort OCR kick-off; no file on disk for placeholders.
  runOcr(docId).catch(() => {});

  return docId;
}

// ---------------------------------------------------------------------------
// POST /spa/api/sync/replay
// ---------------------------------------------------------------------------
router.post('/sync/replay', (req, res) => {
  const role = req.session.user?.role;
  if (!role || !rbac.can(role, 'capture')) {
    return res.status(403).json({ error: 'forbidden', perm: 'capture' });
  }

  const userId   = req.session.user.id;
  const tenantId = tenantScope(req);

  const { outbox_entries } = req.body ?? {};

  if (!Array.isArray(outbox_entries) || outbox_entries.length === 0) {
    return res.status(400).json({ error: 'outbox_entries must be a non-empty array' });
  }

  // Cap batch size to 100 to prevent abuse.
  if (outbox_entries.length > 100) {
    return res.status(400).json({ error: 'outbox_entries exceeds maximum batch size of 100' });
  }

  const accepted = [];
  const deduped  = [];
  const failed   = [];

  for (const entry of outbox_entries) {
    const { idempotency_key: iKey, payload } = entry ?? {};

    // Validate idempotency_key format.
    if (!iKey || !UUID_RE.test(iKey)) {
      failed.push({ idempotency_key: iKey ?? null, error: 'invalid_idempotency_key' });
      continue;
    }

    // Build a canonical hash of the payload (excludes file blobs — those live
    // in IndexedDB and are not part of the JSON replay body).
    const requestHash = sha256(payload ?? {});

    // Check for an existing idempotency record.
    const existing = getIdempotency(iKey, requestHash, tenantId, userId);

    if (existing !== null) {
      if (!existing.match) {
        // Same key, different hash — conflict.
        failed.push({
          idempotency_key: iKey,
          error: 'idempotency_conflict',
          message: 'Idempotency-Key already used with different request body',
        });
        continue;
      }
      // Cache hit — return the previously cached response without re-inserting.
      let cachedBody = null;
      try { cachedBody = JSON.parse(existing.row.response_body); } catch { cachedBody = null; }
      deduped.push({
        idempotency_key: iKey,
        document_id: cachedBody?.id ?? null,
        status: existing.row.response_status,
      });
      continue;
    }

    // New entry — replay the upload.
    try {
      const docId = replayEntry(payload, userId, tenantId);

      const responseBody = {
        ok: true,
        id: docId,
        status: 'Valid',
        idempotency_key: iKey,
      };

      // Cache the result so future replays of the same key are deduped.
      storeIdempotency({
        key: iKey,
        tenantId,
        userId,
        endpoint: 'POST /spa/api/documents',
        requestHash,
        responseStatus: 201,
        responseBody,
      });

      accepted.push({ idempotency_key: iKey, document_id: docId });
    } catch (err) {
      failed.push({ idempotency_key: iKey, error: err.message });
    }
  }

  // Audit — counts only, never raw payloads.
  writeAudit({
    userId,
    action:         'OFFLINE_SYNC_REPLAY',
    entity:         'offline_sync',
    entityId:       null,
    details:        {
      accepted_count: accepted.length,
      deduped_count:  deduped.length,
      failed_count:   failed.length,
    },
    tenantId,
    policyDecision: buildPolicyDecision(req),
  });

  return res.status(200).json({ accepted, deduped, failed });
});

// ---------------------------------------------------------------------------
// GET /spa/api/sync/status
// ---------------------------------------------------------------------------
router.get('/sync/status', (req, res) => {
  const userId   = req.session.user.id;
  const tenantId = tenantScope(req);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Pull OFFLINE_SYNC_REPLAY audit rows for this user in the last 7d.
  const rows = db.prepare(
    `SELECT details, created_at
       FROM audit_log
      WHERE user_id   = ?
        AND tenant_id = ?
        AND action    = 'OFFLINE_SYNC_REPLAY'
        AND created_at >= ?
      ORDER BY created_at DESC`
  ).all(userId, tenantId, sevenDaysAgo);

  let replayed    = 0;
  let deduped     = 0;
  let failedCount = 0;
  let lastSyncAt  = null;

  for (const row of rows) {
    if (!lastSyncAt) lastSyncAt = row.created_at;
    try {
      const d = JSON.parse(row.details);
      replayed    += (d.accepted_count ?? 0);
      deduped     += (d.deduped_count  ?? 0);
      failedCount += (d.failed_count   ?? 0);
    } catch {
      // malformed detail — skip
    }
  }

  return res.json({
    replayed,
    deduped,
    failed_count: failedCount,
    last_sync_at: lastSyncAt,
  });
});

module.exports = router;

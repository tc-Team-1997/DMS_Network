/**
 * Offline-sync background worker — Req 58.
 *
 * Every `intervalSec` (default 15) this module:
 *  1. Pops an item from each tenant's offline queue.
 *  2. Replays the upload by calling the documents-router logic directly
 *     (no loopback HTTP — uses the same DB + fs path the router uses).
 *  3. On success, optionally writes a dedup_decisions row if the Python
 *     service returned a dedup result.
 *  4. On failure, increments _retry_count and re-enqueues; after 5 retries
 *     the item moves to the dead-letter queue and an audit row is written.
 *  5. Logs [offline-sync] drained N items in Xms.
 *
 * Call start(intervalSec?) from server.js after the existing crons.
 */
'use strict';

const path    = require('path');
const fs      = require('fs');
const db      = require('../db');
const { runOcr } = require('./ocr');
const {
  dequeue,
  size,
  enqueue,
  pushDeadLetter,
  recordSync,
} = require('./offline-queue');
const { writeDecision } = require('./duplicates');
const { pyCall }        = require('../routes/spa-api/_shared');

const MAX_RETRIES = 5;

// Columns mirrored from metadata to flat columns (same list as documents.js).
const MIRRORED_COLUMNS = [
  'customer_cid', 'customer_name', 'doc_number',
  'dob', 'issue_date', 'expiry_date', 'issuing_authority',
];

/**
 * Attempt to replay one queued upload payload.
 * Returns the new document id on success.
 * Throws on failure.
 */
async function replayUpload(payload) {
  const { file, body, userId, tenantId } = payload;

  // Verify the staged file still exists on disk.
  if (!fs.existsSync(file.path)) {
    throw new Error(`staged file missing: ${file.path}`);
  }

  // Move from offline-tmp to the main uploads dir so the doc is accessible.
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const destFilename = `${Date.now()}-${path.basename(file.filename)}`;
  const destPath     = path.join(uploadsDir, destFilename);
  fs.renameSync(file.path, destPath);

  // Parse metadata exactly as the documents router does.
  let metadata = {};
  if (typeof body.metadata_json === 'string' && body.metadata_json.trim()) {
    try { metadata = JSON.parse(body.metadata_json); } catch {
      throw new Error('invalid_metadata_json');
    }
  }
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

  const info = db.prepare(
    `INSERT INTO documents
       (filename, original_name, doc_type, customer_cid, customer_name,
        doc_number, dob, issue_date, expiry_date, issuing_authority,
        branch, folder_id, status, version, size, mime_type, notes,
        uploaded_by, tenant_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Valid', 'v1.0', ?, ?, ?, ?, ?, ?)`,
  ).run(
    destFilename, file.originalname,
    body.doc_type || null,
    flat.customer_cid, flat.customer_name, flat.doc_number,
    flat.dob, flat.issue_date, flat.expiry_date, flat.issuing_authority,
    body.branch || null,
    body.folder_id ? parseInt(body.folder_id, 10) : null,
    file.size, file.mimetype, body.notes || null,
    userId, tenantId,
    JSON.stringify(metadata),
  );

  const docId = info.lastInsertRowid;

  // Kick off Tesseract OCR (fire-and-forget, same as the live route).
  runOcr(docId).catch(() => {});

  // Attempt a dedup check via Python — write a dedup_decisions row if we get
  // a result back.  This is best-effort; failure doesn't roll back the insert.
  try {
    const dedupResult = await pyCall('/api/v1/docbrain/dedup-check', {
      method: 'POST',
      body:   { document_id: docId, tenant_id: tenantId },
      timeout: 15_000,
    });
    if (dedupResult && dedupResult.decision) {
      writeDecision({
        tenantId,
        docId,
        matchedDocId: dedupResult.matched_doc_id ?? null,
        score:        dedupResult.score           ?? null,
        decision:     dedupResult.decision,
      });
    }
  } catch {
    // Python service unreachable or endpoint not yet implemented — ignore.
  }

  return docId;
}

/**
 * Drain the offline queue for one tenant.
 * Returns { drained, failed } counts.
 */
async function drainTenant(tenantId) {
  let drained = 0;
  let failed  = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const item = await dequeue(tenantId);
    if (!item) break;   // queue empty

    try {
      await replayUpload(item);
      drained += 1;
    } catch (err) {
      const retryCount = (item._retry_count || 0) + 1;
      if (retryCount >= MAX_RETRIES) {
        // Dead-letter the item and write an audit row.
        await pushDeadLetter({ ...item, _retry_count: retryCount, _last_error: err.message }, tenantId);
        db.prepare(
          'INSERT INTO audit_log (user_id, action, entity, details, tenant_id) VALUES (?, ?, ?, ?, ?)'
        ).run(
          item.userId || null,
          'OFFLINE_SYNC_DEAD_LETTER',
          'offline_queue',
          JSON.stringify({ error: err.message, retry_count: retryCount }),
          tenantId,
        );
        console.error(`[offline-sync] dead-lettered item after ${retryCount} retries (tenant=${tenantId}):`, err.message);
      } else {
        // Push back with incremented retry count.
        await enqueue({ ...item, _retry_count: retryCount }, tenantId);
      }
      failed += 1;
    }
  }

  return { drained, failed };
}

// Known tenants — for the single-tenant MVP only 'nbe'.
// Extend this to query distinct tenant_ids from dedup_settings if needed.
const TENANTS = (process.env.OFFLINE_SYNC_TENANTS || 'nbe').split(',').map(t => t.trim()).filter(Boolean);

/**
 * One sync tick: drain every tenant, log the result, update sync metadata.
 */
async function tick() {
  const start = Date.now();
  let totalDrained = 0;
  let totalFailed  = 0;

  for (const tenantId of TENANTS) {
    try {
      const { drained, failed } = await drainTenant(tenantId);
      totalDrained += drained;
      totalFailed  += failed;
    } catch (err) {
      console.error(`[offline-sync] unexpected error for tenant ${tenantId}:`, err.message);
    }
  }

  const elapsed = Date.now() - start;
  if (totalDrained > 0 || totalFailed > 0) {
    console.log(
      `[offline-sync] drained ${totalDrained} items in ${elapsed}ms` +
      (totalFailed ? ` (${totalFailed} failed/retried)` : '')
    );
  }

  // Record sync metadata for the default tenant (or each tenant separately if
  // multi-tenant support is needed — for MVP just record on 'nbe').
  for (const tenantId of TENANTS) {
    await recordSync({
      last_sync_at:     new Date().toISOString(),
      last_sync_result: `drained=${totalDrained} failed=${totalFailed} elapsed=${elapsed}ms`,
    }, tenantId);
  }
}

let _timer = null;

/**
 * Start the background sync worker.
 * Call once from server.js; idempotent (calling again is a no-op).
 *
 * @param {number} [intervalSec=15]
 */
function start(intervalSec = 15) {
  if (_timer) return;
  const ms = intervalSec * 1000;
  // Run immediately on first boot (after a short delay so routes finish mounting).
  setTimeout(() => {
    tick().catch(err => console.error('[offline-sync] tick error:', err.message));
    _timer = setInterval(() => {
      tick().catch(err => console.error('[offline-sync] tick error:', err.message));
    }, ms);
  }, 2_000);

  console.log(`[offline-sync] started — polling every ${intervalSec}s`);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, tick, drainTenant };

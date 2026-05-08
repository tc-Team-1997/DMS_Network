/**
 * Offline queue endpoints — Req 58.
 *
 * POST /spa/api/offline/enqueue
 *   Accepts the same multipart payload as POST /spa/api/documents but writes
 *   it to the offline queue instead of uploading immediately.
 *   Returns { queued: true, queue_position: N, estimated_sync_at: ISO }.
 *
 * GET /spa/api/offline/status
 *   Returns { queue_depth, oldest_item_age_seconds, last_sync_at, last_sync_result }.
 */
'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { tenantScope } = require('./_shared');
const {
  enqueue,
  size,
  peek,
  getSyncMeta,
} = require('../../services/offline-queue');

const router = express.Router();

// -------------------------------------------------------------------------
// Multer — same MIME whitelist and 50 MB cap as /spa/api/documents.
// Files are written to uploads/offline-tmp/ so they survive until the
// background worker processes them.
// -------------------------------------------------------------------------
const offlineUploadsDir = path.join(__dirname, '..', '..', 'uploads', 'offline-tmp');
if (!fs.existsSync(offlineUploadsDir)) fs.mkdirSync(offlineUploadsDir, { recursive: true });

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
    destination: (_req, _file, cb) => cb(null, offlineUploadsDir),
    filename:    (_req, file,  cb) => cb(null, `${Date.now()}-${safeName(file.originalname)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) return cb(new Error('mime_not_allowed'));
    cb(null, true);
  },
});

// -------------------------------------------------------------------------
// POST /spa/api/offline/enqueue
// -------------------------------------------------------------------------
router.post('/offline/enqueue', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file_required' });

  const tenant = tenantScope(req);
  const body   = req.body ?? {};

  // Serialise the minimal payload needed for the background worker to replay
  // the upload via the documents router logic.
  const payload = {
    file: {
      filename:     req.file.filename,
      originalname: req.file.originalname,
      mimetype:     req.file.mimetype,
      size:         req.file.size,
      path:         req.file.path,
    },
    body: {
      doc_type:      body.doc_type      || null,
      branch:        body.branch        || null,
      folder_id:     body.folder_id     || null,
      notes:         body.notes         || null,
      metadata_json: body.metadata_json || null,
      // Legacy flat fields
      customer_cid:       body.customer_cid       || null,
      customer_name:      body.customer_name       || null,
      doc_number:         body.doc_number          || null,
      dob:                body.dob                 || null,
      issue_date:         body.issue_date          || null,
      expiry_date:        body.expiry_date         || null,
      issuing_authority:  body.issuing_authority   || null,
    },
    userId:   req.session.user.id,
    tenantId: tenant,
  };

  try {
    const position = await enqueue(payload, tenant);
    // Estimate sync at next background-worker tick (15 s from now).
    const estimated = new Date(Date.now() + 15_000).toISOString();
    res.json({ queued: true, queue_position: position, estimated_sync_at: estimated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------------
// GET /spa/api/offline/status
// -------------------------------------------------------------------------
router.get('/offline/status', async (req, res) => {
  const tenant = tenantScope(req);
  try {
    const depth = await size(tenant);
    const meta  = await getSyncMeta(tenant);

    // Determine oldest item age by peeking at one item.
    let oldest_item_age_seconds = null;
    if (depth > 0) {
      const oldest = await peek(1, tenant);
      if (oldest.length && oldest[0]._queued_at) {
        const ms = Date.now() - new Date(oldest[0]._queued_at).getTime();
        oldest_item_age_seconds = Math.round(ms / 1000);
      }
    }

    res.json({
      queue_depth: depth,
      oldest_item_age_seconds,
      last_sync_at:     meta.last_sync_at     || null,
      last_sync_result: meta.last_sync_result || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

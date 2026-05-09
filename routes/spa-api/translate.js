'use strict';
/**
 * SPA mirror for the translation service.
 *
 * Mounted at /spa/api by routes/spa-api.js (alongside docbrain, documents, …).
 * All routes require an active session.  Document-level translation requires
 * `translate:read`; DSAR erasure requires `translate:delete`.
 *
 * Audit contract: every translate request writes DOCUMENT_TRANSLATED to
 * audit_log with { document_id, target_lang, char_count }.  The actual
 * translated text is NEVER logged (PII containment).
 */

const express = require('express');
const db = require('../../db');
const { pyCall, requirePermJson, tenantScope } = require('./_shared');

const router = express.Router();

// ---------------------------------------------------------------------------
// Inline audit helper (does not import from documents.js to avoid coupling)
// ---------------------------------------------------------------------------

/**
 * Write an audit_log row.
 * @param {object} opts
 * @param {number|null} opts.userId
 * @param {string} opts.action
 * @param {string} opts.entity
 * @param {string|number|null} opts.entityId
 * @param {object} opts.details  — must NOT contain source/target text
 * @param {string} opts.tenantId
 */
function writeAudit({ userId, action, entity, entityId, details, tenantId }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId ?? null,
      action,
      entity,
      entityId != null ? String(entityId) : null,
      typeof details === 'string' ? details : JSON.stringify(details),
      tenantId || 'nbe'
    );
  } catch (err) {
    // Non-fatal — never let audit failure break the response path.
    console.error('[translate] audit write failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /spa/api/translate/languages — list supported language pairs
// ---------------------------------------------------------------------------

router.get('/translate/languages', async (req, res) => {
  try {
    const data = await pyCall('/api/v1/translate/languages');
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({
      error: 'translate_languages_failed',
      detail: err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/translate — translate arbitrary text
// ---------------------------------------------------------------------------

router.post('/translate', requirePermJson('translate:read'), async (req, res) => {
  const { text, source_lang, target_lang } = req.body ?? {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }
  if (!source_lang || !target_lang) {
    return res.status(400).json({ error: 'source_lang and target_lang required' });
  }
  if (text.length > 10_000) {
    return res.status(413).json({
      error: 'invalid_text_length',
      message: `Input exceeds 10000 characters (got ${text.length}).`,
    });
  }

  const userId = req.session?.user?.id ?? null;
  const tenantId = tenantScope(req);

  try {
    const data = await pyCall('/api/v1/translate', {
      method: 'POST',
      body: { text, source_lang, target_lang },
    });

    // Audit: log char_count, NOT the text itself.
    writeAudit({
      userId,
      action: 'DOCUMENT_TRANSLATED',
      entity: 'translation',
      entityId: null,
      details: {
        document_id: null,
        target_lang,
        char_count: text.length,
        source_lang,
        cache_hit: data?.cache_hit ?? null,
      },
      tenantId,
    });

    res.json(data);
  } catch (err) {
    if (err.status === 501) {
      return res.status(501).json({ error: 'feature_disabled', detail: err.message });
    }
    res.status(err.status || 502).json({
      error: 'translate_failed',
      detail: err.message,
      data: err.data,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/translate/document/:id — translate a document's OCR text
// ---------------------------------------------------------------------------

router.post(
  '/translate/document/:id',
  requirePermJson('translate:read'),
  async (req, res) => {
    const docId = parseInt(req.params.id, 10);
    if (!Number.isFinite(docId) || docId < 1) {
      return res.status(400).json({ error: 'invalid document id' });
    }

    const { target_lang } = req.body ?? {};
    if (!target_lang || typeof target_lang !== 'string') {
      return res.status(400).json({ error: 'target_lang required' });
    }

    const userId = req.session?.user?.id ?? null;
    const tenantId = tenantScope(req);

    // Verify document exists and the user's branch can access it (if scoped).
    const doc = db
      .prepare('SELECT id, customer_name FROM documents WHERE id = ?')
      .get(docId);
    if (!doc) {
      return res.status(404).json({ error: 'document_not_found' });
    }

    try {
      const data = await pyCall(`/api/v1/translate/document/${docId}`, {
        method: 'POST',
        body: { target_lang },
        timeout: 120_000, // 2 min — cold model inference can take up to 30s
      });

      // Audit: log document_id + char_count; never log the translated text.
      const charCount =
        typeof data?.original_text_preview === 'string'
          ? data.original_text_preview.length
          : 0;

      writeAudit({
        userId,
        action: 'DOCUMENT_TRANSLATED',
        entity: 'document',
        entityId: docId,
        details: {
          document_id: docId,
          target_lang,
          char_count: charCount,
          source_lang: data?.source_lang ?? null,
          cache_hit: data?.cache_hit ?? null,
          model_version: data?.model_version ?? null,
        },
        tenantId,
      });

      res.json(data);
    } catch (err) {
      if (err.status === 501) {
        return res.status(501).json({ error: 'feature_disabled', detail: err.message });
      }
      if (err.status === 422) {
        return res.status(422).json({ error: 'empty_ocr_text', data: err.data });
      }
      res.status(err.status || 502).json({
        error: 'translate_document_failed',
        detail: err.message,
        data: err.data,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /spa/api/translate/:cacheKey — DSAR erasure (doc_admin only)
// ---------------------------------------------------------------------------

router.delete(
  '/translate/:cacheKey',
  requirePermJson('translate:delete'),
  async (req, res) => {
    const { cacheKey } = req.params;

    // SHA-256 hex strings are exactly 64 characters.
    if (!/^[0-9a-f]{64}$/.test(cacheKey)) {
      return res.status(400).json({ error: 'invalid cache key format' });
    }

    const userId = req.session?.user?.id ?? null;
    const tenantId = tenantScope(req);

    try {
      const data = await pyCall(`/api/v1/translate/${cacheKey}`, {
        method: 'DELETE',
      });

      writeAudit({
        userId,
        action: 'TRANSLATION_DELETED',
        entity: 'translation',
        entityId: cacheKey.slice(0, 16) + '...',
        details: { cache_key_prefix: cacheKey.slice(0, 16) },
        tenantId,
      });

      res.json(data);
    } catch (err) {
      if (err.status === 501) {
        return res.status(501).json({ error: 'feature_disabled', detail: err.message });
      }
      res.status(err.status || 502).json({
        error: 'translate_delete_failed',
        detail: err.message,
      });
    }
  }
);

module.exports = router;

/**
 * Indexing / QA queue. Surfaces documents that need manual metadata
 * correction: low OCR confidence, missing doc_type, or missing key
 * identifiers (customer name/CID, doc_number).
 */
const express = require('express');
const db = require('../../db');
const { branchScope, requirePermJson } = require('./_shared');

const router = express.Router();

// Columns a Maker / Indexer can legitimately edit during triage.
const EDITABLE_FIELDS = [
  'doc_type', 'customer_cid', 'customer_name', 'doc_number',
  'dob', 'issue_date', 'expiry_date', 'issuing_authority', 'notes',
];

router.get('/indexing', (req, res) => {
  const scope = branchScope(req.session.user);
  const limit = Math.min(parseInt(String(req.query.limit ?? 100), 10) || 100, 500);
  const onlyLowConfidence = String(req.query.low_conf ?? '') === '1';

  let sql = `
    SELECT id, filename, original_name, doc_type, customer_cid, customer_name,
           doc_number, dob, issue_date, expiry_date, issuing_authority,
           branch, status, ocr_confidence, uploaded_at, notes
    FROM documents
    WHERE (
      ocr_confidence IS NULL
      OR ocr_confidence < 70
      OR doc_type IS NULL
      OR (customer_name IS NULL AND customer_cid IS NULL)
      OR doc_number IS NULL
    )
  `;
  const params = [];
  if (scope) { sql += ' AND branch = ?'; params.push(scope); }
  if (onlyLowConfidence) { sql += ' AND (ocr_confidence IS NULL OR ocr_confidence < 70)'; }
  sql += ' ORDER BY uploaded_at DESC LIMIT ?';
  params.push(limit);

  res.json(db.prepare(sql).all(...params));
});

router.get('/indexing/stats', (req, res) => {
  const scope = branchScope(req.session.user);
  const branchClause = scope ? ' AND branch = ?' : '';
  const p = scope ? [scope] : [];
  const count = (extra) =>
    db.prepare(
      `SELECT COUNT(*) c FROM documents WHERE 1=1 ${extra}${branchClause}`,
    ).get(...p).c;

  res.json({
    low_confidence: count('AND (ocr_confidence IS NULL OR ocr_confidence < 70)'),
    missing_type:   count('AND doc_type IS NULL'),
    missing_owner:  count('AND customer_name IS NULL AND customer_cid IS NULL'),
    missing_number: count('AND doc_number IS NULL'),
  });
});

router.patch('/indexing/:id', requirePermJson('index'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  const doc = db.prepare('SELECT id, branch FROM documents WHERE id = ?').get(id);
  if (!doc) return res.status(404).json({ error: 'not_found' });

  // Branch scoping — Makers/Viewers can only edit their own branch.
  const scope = branchScope(req.session.user);
  if (scope && doc.branch !== scope) {
    return res.status(403).json({ error: 'out_of_branch' });
  }

  const body = req.body ?? {};
  const updates = [];
  const values = [];
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates.push(`${field} = ?`);
      values.push(body[field] === '' ? null : body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'no_fields' });
  values.push(id);

  db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
  ).run(req.session.user.id, 'INDEX_UPDATE', 'document', id, JSON.stringify(body));

  res.json({ ok: true });
});

module.exports = router;

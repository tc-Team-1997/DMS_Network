'use strict';
/**
 * Search Results v2 — Plan 3 (Wave-E1) Task #7.
 *
 * GET /spa/api/search/v2?q=...&type=...&branch=...&status=...
 *
 * Returns BM25-scored results from the existing documents_fts virtual table
 * (created in db/schema.sql alongside Wave-A document model), plus facet
 * counts for type / branch / status that drive the FacetsSidebar on the SPA.
 *
 * FTS5 highlight() is rendered via the `snippet()` auxiliary function with
 * `<mark>` tags — sanitized + dangerouslySetInnerHTML on the client side
 * (DOMPurify). Mirrors the v1 behaviour at routes/spa-api/search.js:242.
 *
 * RBAC: any authenticated session (search hits are already branch-scoped
 * via tenant_id + branch_id checks). No new perm key needed.
 *
 * Mounted in routes/spa-api.js after auth.
 */

const express = require('express');
const db = require('../../db');
const { tenantScope, branchScope } = require('./_shared');

const router = express.Router();

const ALLOWED_DOCTYPES = new Set(['passport', 'kyc', 'loan', 'statement', 'invoice', 'other']);
const SNIPPET_LEN = 8;

function countBy(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (k !== null && k !== undefined && k !== '') {
      out[k] = (out[k] || 0) + 1;
    }
  }
  return out;
}

router.get('/search/v2', (req, res) => {
  const q = String(req.query.q || '').trim();
  const type = req.query.type ? String(req.query.type) : null;
  const branch = req.query.branch ? String(req.query.branch) : null;
  const status = req.query.status ? String(req.query.status) : null;

  const tenant = tenantScope(req);
  const scopedBranch = branchScope(req.session?.user || {});

  if (q.length === 0) {
    return res.json({
      query:   '',
      results: [],
      facets:  { type: {}, branch: {}, status: {} },
      total:   0,
      took_ms: 0,
    });
  }

  const t0 = Date.now();

  // Match clause uses the FTS5 virtual table — bm25() + snippet() require
  // documents_fts MATCH in the WHERE so the auxiliary functions resolve.
  // Build the SQL incrementally so unused filters don't bloat the plan.
  let sql = `
    SELECT d.id, d.original_name, d.customer_name, d.customer_cid,
           d.doc_number, d.branch_id, d.status, d.doctype,
           snippet(documents_fts, -1, '<mark>', '</mark>', '…', ?) AS snippet,
           bm25(documents_fts) AS score
    FROM documents_fts
    JOIN documents d ON d.id = documents_fts.rowid
    WHERE documents_fts MATCH ?
      AND d.tenant_id = ?
  `;
  const params = [SNIPPET_LEN, q, tenant];

  if (type && ALLOWED_DOCTYPES.has(type)) {
    sql += ' AND d.doctype = ?';
    params.push(type);
  }
  if (branch) {
    sql += ' AND d.branch_id = ?';
    params.push(branch);
  } else if (scopedBranch) {
    // Branch-scoped users only see their own branch.
    sql += ' AND d.branch_id = ?';
    params.push(scopedBranch);
  }
  if (status) {
    sql += ' AND d.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY score LIMIT 50';

  let results;
  try {
    results = db.prepare(sql).all(...params);
  } catch (err) {
    // FTS5 MATCH parse errors come back as "fts5: syntax error" — return an
    // empty result set so the SPA can render an empty state instead of 500.
    if (err && /fts5/i.test(err.message || '')) {
      return res.json({
        query: q,
        results: [],
        facets: { type: {}, branch: {}, status: {} },
        total: 0,
        took_ms: Date.now() - t0,
        error: err.message,
      });
    }
    throw err;
  }

  const facets = {
    type:   countBy(results, (r) => r.doctype),
    branch: countBy(results, (r) => r.branch_id),
    status: countBy(results, (r) => r.status),
  };

  res.json({
    query:   q,
    results,
    facets,
    total:   results.length,
    took_ms: Date.now() - t0,
  });
});

module.exports = router;

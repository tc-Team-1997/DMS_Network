'use strict';

/**
 * Search v2 — /spa/api/search* and /spa/api/admin/search/rebuild-fts
 *
 * Endpoints
 * ─────────
 * GET  /spa/api/search
 *   Query: q, scope, doc_type[], branch[], risk_band[], status[],
 *          uploaded_after, uploaded_before, expiry_within_days,
 *          customer_cid, page, page_size
 *   Returns: { results, facets, total, page, page_size, pages }
 *
 * POST /spa/api/search/saved
 *   Body: { name, query, scope }   → inserts a saved search row
 *
 * GET  /spa/api/search/saved
 *   Returns saved searches visible to the caller
 *   (private = own; team = same branch; tenant = all in tenant)
 *
 * PATCH /spa/api/search/saved/:id/touch
 *   Updates last_run_at for a saved search (caller must own it)
 *
 * DELETE /spa/api/search/saved/:id
 *   Deletes a saved search (owner only; Doc Admin may delete any)
 *
 * POST /spa/api/search/cmdk
 *   Body: { q }
 *   Fast multi-source search for the Cmd-K palette
 *
 * POST /spa/api/admin/search/rebuild-fts
 *   Doc Admin only. Drops + recreates the documents_fts virtual table
 *   and its three triggers using the searchable_fields from tenant_config.
 *
 * Facet aggregation note
 * ──────────────────────
 * v1 facet strategy: one COUNT(*) GROUP BY query per facet field,
 * executed in parallel (Promise.all — synchronous SQLite calls here,
 * but logically parallel in intent).
 * Acceptable for tenants up to ~100k documents. For larger tenants,
 * consider a precomputed facet cache (e.g., materialized view refreshed
 * nightly) — flagged for Wave C performance pass.
 */

const express = require('express');
const db = require('../../db');
const { requirePermJson, tenantScope, branchScope } = require('./_shared');
const { getNamespace } = require('../../db/tenant-config');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the search config namespace for a tenant; supply safe defaults. */
function searchConfig(tenantId) {
  let cfg = {};
  try { cfg = getNamespace(tenantId, 'search'); } catch (_) { /* not yet seeded */ }
  return {
    searchableFields: Array.isArray(cfg.searchable_fields)
      ? cfg.searchable_fields
      : ['original_name', 'customer_name', 'customer_cid', 'doc_number', 'ocr_text', 'notes'],
    snippetLength: typeof cfg.snippet_length === 'number'
      ? Math.max(8, Math.min(200, cfg.snippet_length))
      : 24,
    maxResultsPerPage: typeof cfg.max_results_per_page === 'number'
      ? Math.max(10, Math.min(1000, cfg.max_results_per_page))
      : 100,
    facetFields: Array.isArray(cfg.facet_fields)
      ? cfg.facet_fields
      : ['doc_type', 'branch', 'risk_band', 'status'],
  };
}

// Mapping from facet_fields config names → documents table column names.
const FACET_COLUMN_MAP = /** @type {Record<string,string>} */ ({
  doc_type:        'doc_type',
  branch:          'branch',
  risk_band:       'risk_band',
  status:          'status',
  customer_branch: 'branch',
});

/**
 * Build the shared WHERE clause + params.
 * When excludeFacet is set, that filter dimension is omitted so facet queries
 * can show the full value distribution for that dimension.
 */
function buildWhere(filters, excludeFacet) {
  const {
    q, docTypes, branches, riskBands, statuses,
    uploadedAfter, uploadedBefore, expiryWithinDays,
    customerCid, roleFilter,
  } = filters;

  const clauses = [];
  const params = [];

  if (q && q.trim()) {
    const tokens = q.trim().split(/\s+/).filter(Boolean);
    const fts = tokens.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');
    clauses.push('d.id IN (SELECT rowid FROM documents_fts WHERE documents_fts MATCH ?)');
    params.push(fts);
  }

  if (docTypes && docTypes.length > 0 && excludeFacet !== 'doc_type') {
    clauses.push(`d.doc_type IN (${docTypes.map(() => '?').join(',')})`);
    params.push(...docTypes);
  }
  if (branches && branches.length > 0 && excludeFacet !== 'branch') {
    clauses.push(`d.branch IN (${branches.map(() => '?').join(',')})`);
    params.push(...branches);
  }
  if (riskBands && riskBands.length > 0 && excludeFacet !== 'risk_band') {
    clauses.push(`d.risk_band IN (${riskBands.map(() => '?').join(',')})`);
    params.push(...riskBands);
  }
  if (statuses && statuses.length > 0 && excludeFacet !== 'status') {
    clauses.push(`d.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  if (uploadedAfter) {
    clauses.push('d.uploaded_at >= ?');
    params.push(uploadedAfter);
  }
  if (uploadedBefore) {
    clauses.push('d.uploaded_at <= ?');
    params.push(uploadedBefore);
  }
  if (expiryWithinDays) {
    const days = parseInt(String(expiryWithinDays), 10);
    if (!isNaN(days) && days > 0) {
      clauses.push(`d.expiry_date IS NOT NULL AND d.expiry_date <= date('now', '+${days} days')`);
    }
  }
  if (customerCid) {
    clauses.push('d.customer_cid = ?');
    params.push(customerCid);
  }
  if (roleFilter) {
    clauses.push('d.branch = ?');
    params.push(roleFilter);
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

/** Run a single facet count query for one column dimension. */
function runFacetQuery(column, filters, excludeFacet) {
  const { whereClause, params } = buildWhere(filters, excludeFacet);
  // Append the IS NOT NULL guard after the existing WHERE block.
  const extraAnd = whereClause ? `AND d.${column} IS NOT NULL` : `WHERE d.${column} IS NOT NULL`;
  const sql = `
    SELECT d.${column} AS value, COUNT(*) AS count
    FROM documents d
    ${whereClause}
    ${extraAnd}
    GROUP BY d.${column}
    ORDER BY count DESC
    LIMIT 50
  `;
  try {
    return db.prepare(sql).all(...params);
  } catch (_) {
    return [];
  }
}

/** Parse a query string param that may arrive as a string or string[]. */
function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [String(v)].filter(Boolean);
}

// ---------------------------------------------------------------------------
// GET /spa/api/search
// ---------------------------------------------------------------------------

router.get('/search', (req, res) => {
  const user = req.session.user;
  const tenantId = tenantScope(req);
  const cfg = searchConfig(tenantId);

  const q = String(req.query.q ?? '').trim();
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  const pageSizeRaw = parseInt(String(req.query.page_size ?? '20'), 10);
  const pageSize = Math.max(1, Math.min(
    cfg.maxResultsPerPage,
    isNaN(pageSizeRaw) ? 20 : pageSizeRaw,
  ));
  const offset = (page - 1) * pageSize;

  const docTypes  = asArray(req.query['doc_type[]']  ?? req.query.doc_type);
  const branches  = asArray(req.query['branch[]']    ?? req.query.branch);
  const riskBands = asArray(req.query['risk_band[]'] ?? req.query.risk_band);
  const statuses  = asArray(req.query['status[]']    ?? req.query.status);

  const uploadedAfter    = req.query.uploaded_after    ? String(req.query.uploaded_after)    : null;
  const uploadedBefore   = req.query.uploaded_before   ? String(req.query.uploaded_before)   : null;
  const expiryWithinDays = req.query.expiry_within_days ? String(req.query.expiry_within_days) : null;
  const customerCid      = req.query.customer_cid      ? String(req.query.customer_cid)      : null;
  const roleFilter       = branchScope(user);

  const filters = {
    q, docTypes, branches, riskBands, statuses,
    uploadedAfter, uploadedBefore, expiryWithinDays,
    customerCid, roleFilter,
  };

  try {
    // ── Main results query ──────────────────────────────────────────────────
    const snippetLen = cfg.snippetLength;
    let results;

    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      const fts = tokens.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');

      // For the FTS main query, build the WHERE clause WITHOUT the q clause
      // (we put MATCH directly on the FTS table so bm25() and snippet() work).
      // bm25() / snippet() auxiliary functions require the MATCH to appear in
      // the same query level — not via a subquery — so we build two separate
      // clause lists: one MATCH clause + the doc-column filters.
      const { whereClause: docWhere, params: docParams } = buildWhere(
        { ...filters, q: '' }, // suppress the d.id IN (subquery) clause
      );

      // Compose: documents_fts MATCH ? AND <doc-column-filters>
      const matchClause = 'documents_fts MATCH ?';
      const extraFilters = docWhere
        ? `AND ${docWhere.replace(/^WHERE\s+/, '')}`
        : '';
      // snippet() column index: 0=original_name, 1=customer_name, 2=customer_cid,
      // 3=doc_number, 4=ocr_text, 5=notes. Use -1 to let FTS5 pick best column.
      const mainSql = `
        SELECT d.*,
               bm25(documents_fts) AS _score,
               snippet(documents_fts, -1, '<mark>', '</mark>', '…', ?) AS snippet
        FROM documents_fts
        JOIN documents d ON d.id = documents_fts.rowid
        WHERE ${matchClause} ${extraFilters}
        ORDER BY _score
        LIMIT ? OFFSET ?
      `;
      results = db.prepare(mainSql).all(snippetLen, fts, ...docParams, pageSize, offset);
    } else {
      const { whereClause, params: wParams } = buildWhere(filters);
      const mainSql = `
        SELECT d.*, NULL AS _score, NULL AS snippet
        FROM documents d
        ${whereClause}
        ORDER BY d.uploaded_at DESC
        LIMIT ? OFFSET ?
      `;
      results = db.prepare(mainSql).all(...wParams, pageSize, offset);
    }

    // ── Count query ─────────────────────────────────────────────────────────
    let total = 0;
    try {
      if (q) {
        // FTS count: use MATCH directly (same logic as main results query).
        const { whereClause: cDocWhere, params: cDocParams } = buildWhere(
          { ...filters, q: '' },
        );
        const tokens = q.split(/\s+/).filter(Boolean);
        const ftsTerm = tokens.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');
        const cExtraFilters = cDocWhere
          ? `AND ${cDocWhere.replace(/^WHERE\s+/, '')}`
          : '';
        const countSql = `
          SELECT COUNT(*) AS total
          FROM documents_fts
          JOIN documents d ON d.id = documents_fts.rowid
          WHERE documents_fts MATCH ? ${cExtraFilters}
        `;
        const countRow = db.prepare(countSql).get(ftsTerm, ...cDocParams);
        total = (countRow && typeof countRow.total === 'number') ? countRow.total : 0;
      } else {
        const { whereClause: cWhere, params: cParams } = buildWhere(filters);
        const countSql = `SELECT COUNT(*) AS total FROM documents d ${cWhere}`;
        const countRow = db.prepare(countSql).get(...cParams);
        total = (countRow && typeof countRow.total === 'number') ? countRow.total : 0;
      }
    } catch (_) { /* non-fatal — leave total=0 */ }

    // ── Facet queries (one per configured facet field) ───────────────────────
    // v1 facet strategy: one COUNT(*) GROUP BY query per facet field.
    // Acceptable for tenants up to ~100k documents. For larger tenants,
    // consider a precomputed facet cache (e.g., materialized view refreshed
    // nightly) — flagged for Wave C performance pass.
    const activeFacets = cfg.facetFields.filter((f) => f in FACET_COLUMN_MAP);
    const facets = {};
    for (const field of activeFacets) {
      const col = FACET_COLUMN_MAP[field];
      if (!col) continue;
      const rows = runFacetQuery(col, filters, field);
      facets[field] = Object.fromEntries(rows.map((r) => [String(r.value), r.count]));
    }

    return res.json({
      results,
      facets,
      total,
      page,
      page_size: pageSize,
      pages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/search/saved
// ---------------------------------------------------------------------------

router.post('/search/saved', (req, res) => {
  const user = req.session.user;
  const tenantId = tenantScope(req);
  const { name, query, scope } = req.body ?? {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!query || typeof query !== 'object') {
    return res.status(400).json({ error: 'query must be an object' });
  }

  const validScopes = ['private', 'team', 'tenant'];
  const resolvedScope = validScopes.includes(scope) ? String(scope) : 'private';

  if (resolvedScope === 'tenant' && user.role !== 'Doc Admin') {
    return res.status(403).json({ error: 'only Doc Admin may create tenant-scoped saved searches' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO saved_searches (tenant_id, user_id, name, query_json, scope, branch, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(tenantId, user.id, name.trim(), JSON.stringify(query), resolvedScope, user.branch ?? null);

    const saved = db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(saved);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /spa/api/search/saved
// ---------------------------------------------------------------------------

router.get('/search/saved', (req, res) => {
  const user = req.session.user;
  const tenantId = tenantScope(req);

  try {
    const rows = db.prepare(`
      SELECT * FROM saved_searches
      WHERE tenant_id = ?
        AND (
          (scope = 'private' AND user_id = ?)
          OR (scope = 'team'    AND branch = ?)
          OR  scope = 'tenant'
        )
      ORDER BY created_at DESC
    `).all(tenantId, user.id, user.branch ?? '');

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /spa/api/search/saved/:id/touch
// ---------------------------------------------------------------------------

router.patch('/search/saved/:id/touch', (req, res) => {
  const user = req.session.user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  try {
    const existing = db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (existing.user_id !== user.id && user.role !== 'Doc Admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    db.prepare(`UPDATE saved_searches SET last_run_at = datetime('now') WHERE id = ?`).run(id);
    const updated = db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(id);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /spa/api/search/saved/:id
// ---------------------------------------------------------------------------

router.delete('/search/saved/:id', (req, res) => {
  const user = req.session.user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  try {
    const existing = db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (existing.user_id !== user.id && user.role !== 'Doc Admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /spa/api/search/cmdk
// ---------------------------------------------------------------------------

router.post('/search/cmdk', (req, res) => {
  const user = req.session.user;
  const tenantId = tenantScope(req);
  const roleFilter = branchScope(user);
  const q = String(req.body?.q ?? '').trim();
  if (!q) return res.json({ groups: [] });

  const tokens = q.split(/\s+/).filter(Boolean);
  const fts  = tokens.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');
  const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

  const groups = [];

  // Documents — FTS5 top-5.
  try {
    const docSql = roleFilter
      ? `SELECT d.id, d.original_name, d.doc_type, d.branch, d.status
         FROM documents_fts f JOIN documents d ON d.id = f.rowid
         WHERE documents_fts MATCH ? AND d.branch = ?
         ORDER BY bm25(documents_fts) LIMIT 5`
      : `SELECT d.id, d.original_name, d.doc_type, d.branch, d.status
         FROM documents_fts f JOIN documents d ON d.id = f.rowid
         WHERE documents_fts MATCH ?
         ORDER BY bm25(documents_fts) LIMIT 5`;
    const docParams = roleFilter ? [fts, roleFilter] : [fts];
    const docs = db.prepare(docSql).all(...docParams);
    if (docs.length > 0) {
      groups.push({
        group: 'Documents',
        items: docs.map((d) => ({
          type: 'document',
          id: d.id,
          label: d.original_name ?? `Document #${d.id}`,
          meta:  [d.doc_type, d.branch].filter(Boolean).join(' · '),
          href:  `/viewer/${d.id}`,
        })),
      });
    }
  } catch (_) { /* FTS5 error — skip group */ }

  // Saved searches — name LIKE top-5.
  try {
    const saved = db.prepare(`
      SELECT id, name, scope FROM saved_searches
      WHERE tenant_id = ?
        AND name LIKE ? ESCAPE '\\'
        AND (
          (scope = 'private' AND user_id = ?)
          OR (scope = 'team'    AND branch = ?)
          OR  scope = 'tenant'
        )
      ORDER BY created_at DESC LIMIT 5
    `).all(tenantId, like, user.id, user.branch ?? '');
    if (saved.length > 0) {
      groups.push({
        group: 'Saved searches',
        items: saved.map((s) => ({
          type:  'saved_search',
          id:    s.id,
          label: s.name,
          meta:  s.scope,
          href:  `/search?saved=${s.id}`,
        })),
      });
    }
  } catch (_) { /* skip */ }

  // Nav routes — static list filtered by label substring.
  const NAV_ROUTES = [
    { label: 'Dashboard',           href: '/' },
    { label: 'Capture documents',   href: '/capture' },
    { label: 'Indexing',            href: '/indexing' },
    { label: 'Repository',          href: '/repository' },
    { label: 'Workflows',           href: '/workflows' },
    { label: 'Search',              href: '/search' },
    { label: 'Viewer',              href: '/viewer' },
    { label: 'AI Engine',           href: '/ai' },
    { label: 'Alerts',              href: '/alerts' },
    { label: 'Reports & BI',        href: '/reports' },
    { label: 'Compliance',          href: '/compliance' },
    { label: 'Integration',         href: '/integration' },
    { label: 'Security',            href: '/security' },
    { label: 'Users',               href: '/users' },
    { label: 'Admin',               href: '/admin' },
    { label: 'Upload new document', href: '/capture' },
    { label: 'New chat',            href: '/ai' },
  ];
  const lq = q.toLowerCase();
  const matchedRoutes = NAV_ROUTES.filter((r) => r.label.toLowerCase().includes(lq)).slice(0, 5);
  if (matchedRoutes.length > 0) {
    groups.push({
      group: 'Navigation',
      items: matchedRoutes.map((r) => ({ type: 'nav', label: r.label, href: r.href })),
    });
  }

  return res.json({ groups });
});

// ---------------------------------------------------------------------------
// POST /spa/api/admin/search/rebuild-fts   (Doc Admin only)
// ---------------------------------------------------------------------------

const ALLOWED_FTS_COLUMNS = new Set([
  'original_name', 'customer_name', 'customer_cid',
  'doc_number', 'ocr_text', 'notes',
]);

router.post('/admin/search/rebuild-fts', requirePermJson('admin'), (req, res) => {
  const tenantId = tenantScope(req);
  const cfg = searchConfig(tenantId);
  const safeFields = cfg.searchableFields.filter((f) => ALLOWED_FTS_COLUMNS.has(f));

  if (safeFields.length === 0) {
    return res.status(400).json({ error: 'no valid searchable_fields configured' });
  }

  const colList    = safeFields.join(', ');
  const selectCols = safeFields.map((f) => `COALESCE(${f}, '')`).join(', ');
  const newCols    = safeFields.map((f) => `new.${f}`).join(', ');

  try {
    // SQLite exec() runs multiple statements separated by semicolons.
    db.exec(`
      DROP TABLE IF EXISTS documents_fts;
      CREATE VIRTUAL TABLE documents_fts USING fts5(${colList});
      INSERT INTO documents_fts(rowid, ${colList})
        SELECT id, ${selectCols} FROM documents;
      DROP TRIGGER IF EXISTS documents_fts_ai;
      CREATE TRIGGER documents_fts_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, ${colList}) VALUES (new.id, ${newCols});
      END;
      DROP TRIGGER IF EXISTS documents_fts_ad;
      CREATE TRIGGER documents_fts_ad AFTER DELETE ON documents BEGIN
        DELETE FROM documents_fts WHERE rowid = old.id;
      END;
      DROP TRIGGER IF EXISTS documents_fts_au;
      CREATE TRIGGER documents_fts_au AFTER UPDATE ON documents BEGIN
        DELETE FROM documents_fts WHERE rowid = old.id;
        INSERT INTO documents_fts(rowid, ${colList}) VALUES (new.id, ${newCols});
      END;
    `);
    return res.json({ ok: true, fields: safeFields });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

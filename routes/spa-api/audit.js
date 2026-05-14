/**
 * Audit log v2 — SPA API router (Wave C, migration 0038).
 *
 * Endpoints:
 *   GET  /spa/api/audit/events          — paginated event list (filtered)
 *   GET  /spa/api/audit/search          — FTS5 full-text search over detail/action/entity_type
 *   GET  /spa/api/audit/pivot           — entity pivot (by document/customer/workflow/user/config)
 *   POST /spa/api/audit/verify-chain    — server-side chain pre-check (returns head_hash + mismatches)
 *   GET  /spa/api/audit/export          — JSON / CSV / PDF export (self-logged as audit_export)
 *   POST /spa/api/audit/anchor          — OTS chain-head anchor via Python /api/v1/anchor/chain
 *
 * RBAC:
 *   Read  (events, search, pivot, verify-chain) → requireNamespacePermJson('audit_log', 'read')
 *     Allowed roles: Doc Admin, auditor, compliance (NAMESPACE_READERS in services/rbac.js)
 *   Write (export, anchor)               → requireNamespacePermJson('audit_log', 'write')
 *     Allowed roles: Doc Admin only
 *
 * Hash-chain algorithm (shared with db/tenant-config.js and ChainVerifyBadge.tsx):
 *   canonical_json = JSON.stringify(sortedKeys(rowDict))
 *   hash = sha256( (prevHash || '') + canonical_json )
 *
 * PDF export: A4 landscape, 8pt body, 40 rows/page, server-side via pdf-lib.
 * Each export is logged as action='audit_export' in the same session.
 */

'use strict';

const express = require('express');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const db = require('../../db');
const { computeHash, canonicalJson } = require('../../db/hash-chain');
const { requireNamespacePermJson, requirePermJson, tenantScope } = require('./_shared');
const { pyCall } = require('./_shared');
const { buildPolicyDecision } = require('../../services/audit-policy');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical row dict for hash-chain computation.
 * Matches the backfill dict in db/index.js migration 0038 exactly.
 *
 * @param {object} row - raw DB row from audit_log
 * @returns {Record<string, unknown>}
 */
function rowToDict(row) {
  return {
    action:      row.action ?? null,
    created_at:  row.created_at ?? null,
    detail:      row.detail ?? row.details ?? null,
    entity:      row.entity ?? null,
    entity_id:   row.entity_id ?? null,
    entity_type: row.entity_type ?? null,
    id:          row.id,
    result:      row.result ?? 'allow',
    tenant_id:   row.tenant_id ?? null,
    user_id:     row.user_id ?? null,
  };
}

/**
 * Write one audit_log row with hash-chain linkage.
 *
 * @param {object} opts
 * @param {number|null} opts.userId
 * @param {string} opts.action
 * @param {string|null} [opts.entity]
 * @param {string|null} [opts.entityType]
 * @param {number|null} [opts.entityId]
 * @param {object|null} [opts.detail]
 * @param {string} [opts.result]
 * @param {string} opts.tenantId
 * @param {object|null} [opts.policyDecision] - OPA/RBAC decision blob from buildPolicyDecision()
 */
function writeAuditRow(opts) {
  const {
    userId = null,
    action,
    entity = null,
    entityType = null,
    entityId = null,
    detail = null,
    result = 'allow',
    tenantId,
    policyDecision = null,
  } = opts;

  const createdAt = new Date().toISOString();
  const detailJson = detail !== null ? JSON.stringify(detail) : null;
  const policyDecisionJson = policyDecision !== null ? JSON.stringify(policyDecision) : null;

  // Get the last hash for this tenant (or globally — audit chain is per DB, not per tenant).
  const lastRow = db.prepare(
    'SELECT hash FROM audit_log WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1',
  ).get();
  const prevHash = lastRow ? lastRow.hash : null;

  // Build the row dict before INSERT so the hash covers the exact values stored.
  // We need the id, so we INSERT first then UPDATE — SQLite AUTOINCREMENT assigns.
  // Alternative: pre-compute id with MAX(id)+1 in a transaction.
  const insertAndHash = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO audit_log
        (user_id, action, entity, entity_type, entity_id, detail, details, result, tenant_id, created_at, policy_decision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, action, entity, entityType, entityId, detailJson, detailJson, result, tenantId, createdAt, policyDecisionJson);

    const newId = info.lastInsertRowid;

    const rowDict = {
      action,
      created_at: createdAt,
      detail: detailJson,
      entity,
      entity_id: entityId,
      entity_type: entityType,
      id: newId,
      policy_decision: policyDecisionJson,
      result,
      tenant_id: tenantId,
      user_id: userId,
    };
    const hash = computeHash(prevHash, rowDict);

    db.prepare('UPDATE audit_log SET prev_hash = ?, hash = ? WHERE id = ?')
      .run(prevHash, hash, newId);

    return newId;
  });

  try {
    insertAndHash();
  } catch (e) {
    // Audit failures must never block the primary action.
    // eslint-disable-next-line no-console
    console.error('[audit] writeAuditRow failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// GET /spa/api/audit/events
//
// Query params:
//   entity_type   — document|customer|workflow|user|config|system
//   action        — free text substring or exact
//   actor         — username substring
//   from          — ISO date (created_at >=)
//   to            — ISO date (created_at <=)
//   result        — allow|deny|error
//   page          — 1-based (default 1)
//   per_page      — 1-200 (default 50)
// ---------------------------------------------------------------------------
router.get(
  '/audit/events',
  requireNamespacePermJson('audit_log', 'read'),
  (req, res) => {
    const tenant = tenantScope(req);
    const {
      entity_type, action, actor, from, to, result,
      page = '1', per_page = '50',
    } = req.query;

    const perPage = Math.min(Math.max(parseInt(String(per_page), 10) || 50, 1), 200);
    const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
    const offset  = (pageNum - 1) * perPage;

    const clauses = ['(a.tenant_id = ? OR a.tenant_id IS NULL)'];
    const params  = [tenant];

    if (entity_type) { clauses.push('a.entity_type = ?'); params.push(String(entity_type)); }
    if (action)      { clauses.push("a.action LIKE '%' || ? || '%'"); params.push(String(action)); }
    if (actor)       { clauses.push("u.username LIKE '%' || ? || '%'"); params.push(String(actor)); }
    if (from)        { clauses.push('a.created_at >= ?'); params.push(String(from)); }
    if (to)          { clauses.push('a.created_at <= ?'); params.push(String(to)); }
    if (result)      { clauses.push('a.result = ?'); params.push(String(result)); }

    const where = `WHERE ${clauses.join(' AND ')}`;

    const total = db.prepare(`
      SELECT COUNT(*) AS c
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      ${where}
    `).get(...params).c;

    const rows = db.prepare(`
      SELECT
        a.id, a.action, a.entity, a.entity_type, a.entity_id,
        a.detail, a.details, a.result, a.prev_hash, a.hash,
        a.policy_decision, a.tenant_id, a.created_at,
        u.username, u.full_name
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset);

    res.json({ total, page: pageNum, per_page: perPage, events: rows });
  },
);

// ---------------------------------------------------------------------------
// GET /spa/api/audit/search?q=...&page=1&per_page=50
// FTS5 full-text search over audit_log_fts(detail, action, entity_type).
// ---------------------------------------------------------------------------
router.get(
  '/audit/search',
  requireNamespacePermJson('audit_log', 'read'),
  (req, res) => {
    const tenant = tenantScope(req);
    const { q, page = '1', per_page = '50' } = req.query;

    if (!q || !String(q).trim()) {
      return res.status(400).json({ error: 'q is required' });
    }

    const perPage = Math.min(Math.max(parseInt(String(per_page), 10) || 50, 1), 200);
    const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
    const offset  = (pageNum - 1) * perPage;

    // FTS5 query: sanitize to prevent injection via fts5 syntax errors.
    // Wrap in double-quotes so user input is treated as a phrase, not operators.
    const ftsQuery = String(q).replace(/"/g, '""');

    const total = db.prepare(`
      SELECT COUNT(*) AS c
      FROM audit_log_fts f
      JOIN audit_log a ON a.id = f.rowid
      WHERE audit_log_fts MATCH ? AND (a.tenant_id = ? OR a.tenant_id IS NULL)
    `).get(`"${ftsQuery}"`, tenant).c;

    const rows = db.prepare(`
      SELECT
        a.id, a.action, a.entity, a.entity_type, a.entity_id,
        a.detail, a.details, a.result, a.prev_hash, a.hash,
        a.tenant_id, a.created_at,
        u.username, u.full_name,
        snippet(audit_log_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet_detail
      FROM audit_log_fts f
      JOIN audit_log a ON a.id = f.rowid
      LEFT JOIN users u ON u.id = a.user_id
      WHERE audit_log_fts MATCH ? AND (a.tenant_id = ? OR a.tenant_id IS NULL)
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).all(`"${ftsQuery}"`, tenant, perPage, offset);

    res.json({ total, page: pageNum, per_page: perPage, query: String(q), events: rows });
  },
);

// ---------------------------------------------------------------------------
// GET /spa/api/audit/pivot?by=document_id|customer_cid|user_id|entity_type
// ---------------------------------------------------------------------------
router.get(
  '/audit/pivot',
  requireNamespacePermJson('audit_log', 'read'),
  (req, res) => {
    const tenant = tenantScope(req);
    const by = String(req.query.by || 'entity_type');

    const ALLOWED_BY = ['document_id', 'customer_cid', 'user_id', 'entity_type'];
    if (!ALLOWED_BY.includes(by)) {
      return res.status(400).json({ error: `by must be one of: ${ALLOWED_BY.join(', ')}` });
    }

    // Map pivot key to actual column reference.
    const colMap = {
      document_id:   'a.entity_id',
      customer_cid:  'a.entity',          // customer CID is stored in entity for customer rows
      user_id:       'a.user_id',
      entity_type:   'a.entity_type',
    };
    const col = colMap[by];

    const rows = db.prepare(`
      SELECT
        ${col} AS pivot_key,
        COUNT(*)            AS event_count,
        MIN(a.created_at)   AS first_event,
        MAX(a.created_at)   AS last_event,
        GROUP_CONCAT(DISTINCT a.action) AS actions
      FROM audit_log a
      WHERE (a.tenant_id = ? OR a.tenant_id IS NULL)
        AND ${col} IS NOT NULL
      GROUP BY ${col}
      ORDER BY event_count DESC
      LIMIT 500
    `).all(tenant);

    res.json({ by, rows });
  },
);

// ---------------------------------------------------------------------------
// POST /spa/api/audit/verify-chain
// Body: { limit?: number }  (default 1000, max 100000)
//
// Walks the N most recent rows in id ASC order, recomputes each hash, and
// returns { verified, mismatched_rows, head_hash, checked }.
// ---------------------------------------------------------------------------
router.post(
  '/audit/verify-chain',
  requireNamespacePermJson('audit_log', 'read'),
  (req, res) => {
    const tenant = tenantScope(req);
    const rawLimit = parseInt(String(req.body?.limit || '1000'), 10);
    const limit    = Math.min(Math.max(rawLimit || 1000, 1), 100_000);

    // Fetch the N most recent rows, then walk oldest→newest.
    const rows = db.prepare(`
      SELECT
        id, user_id, action, entity, entity_type, entity_id,
        detail, details, result, prev_hash, hash, tenant_id, created_at
      FROM audit_log
      WHERE (tenant_id = ? OR tenant_id IS NULL) AND hash IS NOT NULL
      ORDER BY id DESC
      LIMIT ?
    `).all(tenant, limit).reverse();  // reverse so we walk oldest→newest

    const mismatchedRows = [];
    let prevHash = rows.length > 0 ? (rows[0].prev_hash ?? null) : null;
    let headHash = null;

    for (const row of rows) {
      const rowDict = rowToDict(row);
      const expected = computeHash(prevHash, rowDict);
      if (expected !== row.hash) {
        mismatchedRows.push({ id: row.id, expected, stored: row.hash });
      }
      prevHash = row.hash;
      headHash = row.hash;
    }

    res.json({
      verified:        mismatchedRows.length === 0,
      checked:         rows.length,
      mismatched_rows: mismatchedRows,
      head_hash:       headHash,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /spa/api/audit/export?format=json|csv|pdf&...filters
//
// Same filter params as /events. Self-logs as action='audit_export'.
// ---------------------------------------------------------------------------
router.get(
  '/audit/export',
  requireNamespacePermJson('audit_log', 'write'),
  async (req, res) => {
    const tenant = tenantScope(req);
    const format = String(req.query.format || 'json');
    if (!['json', 'csv', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'format must be json, csv, or pdf' });
    }

    const { entity_type, action, actor, from, to, result } = req.query;

    const clauses = ['(a.tenant_id = ? OR a.tenant_id IS NULL)'];
    const params  = [tenant];

    if (entity_type) { clauses.push('a.entity_type = ?'); params.push(String(entity_type)); }
    if (action)      { clauses.push("a.action LIKE '%' || ? || '%'"); params.push(String(action)); }
    if (actor)       { clauses.push("u.username LIKE '%' || ? || '%'"); params.push(String(actor)); }
    if (from)        { clauses.push('a.created_at >= ?'); params.push(String(from)); }
    if (to)          { clauses.push('a.created_at <= ?'); params.push(String(to)); }
    if (result)      { clauses.push('a.result = ?'); params.push(String(result)); }

    const where = `WHERE ${clauses.join(' AND ')}`;

    const rows = db.prepare(`
      SELECT
        a.id, a.action, a.entity, a.entity_type, a.entity_id,
        a.detail, a.details, a.result, a.hash, a.created_at,
        u.username
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      ${where}
      ORDER BY a.created_at ASC, a.id ASC
    `).all(...params);

    // Log the export as an audit event (fire-and-forget; don't block response).
    const actor_user = req.session?.user;
    writeAuditRow({
      userId:         actor_user?.id ?? null,
      action:         'audit_export',
      entity:         'audit_log',
      entityType:     'config',
      detail:         { format, filters: { entity_type, action, actor, from, to, result }, row_count: rows.length },
      result:         'allow',
      tenantId:       tenant,
      policyDecision: buildPolicyDecision(req),
    });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-export.json"');
      return res.json(rows);
    }

    if (format === 'csv') {
      const headers = ['id', 'created_at', 'username', 'action', 'entity_type', 'entity_id', 'entity', 'result', 'hash'];
      const escape = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const lines = [
        headers.join(','),
        ...rows.map((r) =>
          headers.map((h) => escape(r[h])).join(','),
        ),
      ];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"');
      return res.send(lines.join('\r\n'));
    }

    // PDF — A4 landscape, 8pt body, 40 rows per page.
    const PAGE_W = 841.89;
    const PAGE_H = 595.28;
    const MARGIN_X = 30;
    const MARGIN_Y = 40;
    const ROW_H   = 12;
    const HEADER_H = 16;
    const FONT_SIZE = 8;
    const HEADER_FONT_SIZE = 10;
    const ROWS_PER_PAGE = 40;

    const COL_DEFS = [
      { key: 'id',          label: 'ID',          w: 40 },
      { key: 'created_at',  label: 'Timestamp',   w: 120 },
      { key: 'username',    label: 'Actor',        w: 80 },
      { key: 'action',      label: 'Action',       w: 110 },
      { key: 'entity_type', label: 'Entity Type',  w: 80 },
      { key: 'entity_id',   label: 'Entity ID',    w: 60 },
      { key: 'result',      label: 'Result',       w: 50 },
    ];

    const pdfDoc = await PDFDocument.create();
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    const now = new Date().toISOString();

    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN_Y;

      // Page header
      page.drawText(`Audit Log Export — ${tenant}`, {
        x: MARGIN_X, y,
        size: HEADER_FONT_SIZE, font: fontBold,
        color: rgb(0.05, 0.17, 0.42),
      });
      page.drawText(`Generated: ${now}   Page ${pageIdx + 1} of ${totalPages}`, {
        x: MARGIN_X, y: y - 14,
        size: 7, font,
        color: rgb(0.4, 0.4, 0.4),
      });
      y -= HEADER_H + 14;

      // Column headers
      let x = MARGIN_X;
      for (const col of COL_DEFS) {
        page.drawText(col.label, {
          x, y,
          size: FONT_SIZE, font: fontBold,
          color: rgb(0.05, 0.17, 0.42),
        });
        x += col.w;
      }
      y -= ROW_H;

      // Divider line
      page.drawLine({
        start: { x: MARGIN_X, y },
        end:   { x: PAGE_W - MARGIN_X, y },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y -= 4;

      // Rows for this page
      const pageRows = rows.slice(pageIdx * ROWS_PER_PAGE, (pageIdx + 1) * ROWS_PER_PAGE);
      for (const row of pageRows) {
        x = MARGIN_X;
        for (const col of COL_DEFS) {
          const raw = row[col.key];
          const text = raw === null || raw === undefined ? '' : String(raw).slice(0, 40);
          page.drawText(text, {
            x, y,
            size: FONT_SIZE, font,
            color: rgb(0.17, 0.17, 0.16),
          });
          x += col.w;
        }
        y -= ROW_H;
      }

      // Footer
      page.drawText(`Total events: ${rows.length}`, {
        x: MARGIN_X, y: MARGIN_Y - 10,
        size: 7, font,
        color: rgb(0.4, 0.4, 0.4),
      });
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-export.pdf"');
    return res.send(Buffer.from(pdfBytes));
  },
);

// ---------------------------------------------------------------------------
// POST /spa/api/audit/anchor
// Body: { head_hash?: string }
//
// Triggers a chain-head anchor via Python's /api/v1/anchor/chain.
// Logs the anchor event as action='audit_anchor'.
// ---------------------------------------------------------------------------
router.post(
  '/audit/anchor',
  requireNamespacePermJson('audit_log', 'write'),
  async (req, res) => {
    const tenant = tenantScope(req);
    const headHash = req.body?.head_hash ?? null;
    const actor    = req.session?.user?.username ?? 'system';

    let pyResult;
    try {
      pyResult = await pyCall('/api/v1/anchor/chain', {
        method: 'POST',
        body:   { head_hash: headHash, signer: actor },
        timeout: 15_000,
      });
    } catch (err) {
      return res.status(502).json({ error: 'anchor service unavailable', detail: err.message });
    }

    // Log the anchor event.
    writeAuditRow({
      userId:         req.session?.user?.id ?? null,
      action:         'audit_anchor',
      entity:         'audit_log',
      entityType:     'config',
      detail:         { head_hash: headHash, block_hash: pyResult?.block_hash ?? null },
      result:         'allow',
      tenantId:       tenant,
      policyDecision: buildPolicyDecision(req),
    });

    res.json({
      anchored:   true,
      head_hash:  headHash,
      block_hash: pyResult?.block_hash ?? null,
      ts:         pyResult?.ts ?? null,
      record:     pyResult,
    });
  },
);

// ---------------------------------------------------------------------------
// Plan 3 (Wave-E1) — Task #4: full chain-verify + event-with-context.
// ---------------------------------------------------------------------------

const CHAIN_VIEW = requirePermJson('audit:chain_view');

// GET /spa/api/audit/chain/verify
// Walks the entire audit_log chain from genesis (id ASC), tenant-scoped.
// Returns { verified, count, latest_anchor, broken_at }.
// Read-only — no audit row written.
router.get('/audit/chain/verify', CHAIN_VIEW, (req, res) => {
  const tenant = tenantScope(req);
  const rows = db.prepare(`
    SELECT id, user_id, action, entity, entity_type, entity_id,
           detail, details, result, prev_hash, hash, tenant_id, created_at
    FROM audit_log
    WHERE (tenant_id = ? OR tenant_id IS NULL) AND hash IS NOT NULL
    ORDER BY id ASC
  `).all(tenant);

  let prev = null;
  let brokenAt = null;
  for (const r of rows) {
    if ((r.prev_hash ?? null) !== prev) { brokenAt = r.id; break; }
    const expected = computeHash(prev, rowToDict(r));
    if (expected !== r.hash) { brokenAt = r.id; break; }
    prev = r.hash;
  }

  const latestAnchor = rows.length ? rows[rows.length - 1].hash : null;
  res.json({
    verified:      brokenAt === null,
    count:         rows.length,
    latest_anchor: latestAnchor,
    broken_at:     brokenAt,
  });
});

// GET /spa/api/audit/events/:id/with-context
// Returns one audit row + parsed detail + parsed policy_decision + prev/next
// hash neighbours for the diff drawer's chain-segment panel.
router.get('/audit/events/:id/with-context', CHAIN_VIEW, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const tenant = tenantScope(req);

  const r = db.prepare(`
    SELECT a.id, a.user_id, a.action, a.entity, a.entity_type, a.entity_id,
           a.detail, a.details, a.result, a.prev_hash, a.hash,
           a.policy_decision, a.tenant_id, a.created_at,
           u.username, u.full_name
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.id = ? AND (a.tenant_id = ? OR a.tenant_id IS NULL)
  `).get(id, tenant);
  if (!r) return res.status(404).json({ error: 'not_found' });

  const prev = db.prepare(`
    SELECT id, hash FROM audit_log
    WHERE id < ? AND (tenant_id = ? OR tenant_id IS NULL)
    ORDER BY id DESC LIMIT 1
  `).get(id, tenant);
  const next = db.prepare(`
    SELECT id, hash FROM audit_log
    WHERE id > ? AND (tenant_id = ? OR tenant_id IS NULL)
    ORDER BY id ASC LIMIT 1
  `).get(id, tenant);

  function safeParse(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }

  res.json({
    event: {
      ...r,
      detail:          safeParse(r.detail ?? r.details),
      policy_decision: safeParse(r.policy_decision),
    },
    chain: {
      prev: prev ? { id: prev.id, hash: prev.hash } : null,
      this: { id: r.id, prev_hash: r.prev_hash, hash: r.hash },
      next: next ? { id: next.id, hash: next.hash } : null,
    },
  });
});

// ---------------------------------------------------------------------------
// Test-only chain-tamper endpoints — non-production only.
//
// Plan 3 (Wave-E1) Task #4 follow-up: when NODE_ENV=test the guard is
// relaxed to authenticated-only (no audit:chain_view perm required). Real
// dev (NODE_ENV unset / 'development') keeps the chain-view perm so a
// browsing developer can't accidentally tamper. Production is locked out
// entirely.
//
// The Playwright suite runs against `npm run dev` which sets NODE_ENV via
// the start scripts in package.json; the e2e helper logs in as admin
// (who has audit:chain_view in any case) so the relaxed gate is only
// load-bearing for headless test-rig invocations that aren't yet logged
// in.
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
  const tamperGuard =
    process.env.NODE_ENV === 'test'
      ? (_req, _res, next) => next()            // test rigs bypass perm check
      : CHAIN_VIEW;                              // dev still requires audit:chain_view

  router.post('/audit/_test_break_chain_at', tamperGuard, (req, res) => {
    const id = parseInt(String(req.query.id || ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const tenant = tenantScope(req);
    db.prepare(`
      UPDATE audit_log SET hash = 'TAMPERED'
      WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)
    `).run(id, tenant);
    res.json({ ok: true, broken_at: id });
  });

  router.post('/audit/_test_repair_chain', tamperGuard, (req, res) => {
    // Re-derive hashes by walking forward from genesis. In the test suite we
    // just walk the tenant's rows and recompute prev_hash → hash transitions.
    const tenant = tenantScope(req);
    const rows = db.prepare(`
      SELECT id, user_id, action, entity, entity_type, entity_id,
             detail, details, result, tenant_id, created_at
      FROM audit_log
      WHERE (tenant_id = ? OR tenant_id IS NULL)
      ORDER BY id ASC
    `).all(tenant);
    const upd = db.prepare('UPDATE audit_log SET prev_hash = ?, hash = ? WHERE id = ?');
    let prev = null;
    for (const r of rows) {
      const h = computeHash(prev, rowToDict(r));
      upd.run(prev, h, r.id);
      prev = h;
    }
    res.json({ ok: true, repaired: rows.length });
  });
}

module.exports = Object.assign(router, { writeAuditRow });

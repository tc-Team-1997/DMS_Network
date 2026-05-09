const express = require('express');
const db = require('../../db');
const { scoreDoc } = require('../../services/levenshtein');

const router = express.Router();

/**
 * GET /spa/api/search?q=<query>
 *
 * Three-tier lookup (BRD #19):
 *  1. Exact FTS5 match — each token wrapped in double-quotes.
 *  2. Prefix FTS5 match — each token becomes `token*`.
 *  3. Fuzzy fallback — Levenshtein re-ranking of the 200 most-recent docs.
 *
 * Each result gains a `match_type` field: 'exact' | 'prefix' | 'fuzzy'.
 * Existing callers that ignore `match_type` continue to work unchanged.
 */
router.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json([]);

  const tokens = q.split(/\s+/).filter(Boolean);

  // ── Tier 1: exact match (each token quoted) ─────────────────────────────
  const exactMatch = tokens
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(' ');

  const ftsSQL = `
    SELECT d.* FROM documents_fts f
    JOIN documents d ON d.id = f.rowid
    WHERE documents_fts MATCH ?
    ORDER BY d.uploaded_at DESC
    LIMIT 100
  `;

  try {
    const exactRows = db.prepare(ftsSQL).all(exactMatch);
    if (exactRows.length > 0) {
      return res.json(exactRows.map((r) => ({ ...r, match_type: 'exact' })));
    }
  } catch {
    // FTS5 syntax error from exotic input — fall through to prefix.
  }

  // ── Tier 2: prefix match (each token appended with *) ───────────────────
  const prefixMatch = tokens
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(' ');

  try {
    const prefixRows = db.prepare(ftsSQL).all(prefixMatch);
    if (prefixRows.length > 0) {
      return res.json(prefixRows.map((r) => ({ ...r, match_type: 'prefix' })));
    }
  } catch {
    // Fall through to fuzzy.
  }

  // ── Tier 3: Levenshtein re-ranking of the 200 most-recent documents ─────
  try {
    const recent = db.prepare(
      'SELECT * FROM documents ORDER BY uploaded_at DESC LIMIT 200'
    ).all();

    const lowerTokens = tokens.map((t) => t.toLowerCase());

    // Only surface fuzzy results that are genuinely similar — a minimum
    // score threshold prevents random docs appearing for nonsense queries.
    const maxScore = Math.max(3, Math.ceil(Math.min(...lowerTokens.map((t) => t.length)) * 0.4));

    const scored = recent
      .map((doc) => ({ doc, score: scoreDoc(doc, lowerTokens) }))
      .filter(({ score }) => score <= maxScore)
      .sort((a, b) => a.score - b.score)
      .slice(0, 10)
      .map(({ doc }) => ({ ...doc, match_type: 'fuzzy' }));

    return res.json(scored);
  } catch {
    return res.json([]);
  }
});

module.exports = router;

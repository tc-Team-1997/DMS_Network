const router = require('express').Router();
const db = require('../db');

router.get('/', (req, res) => {
  const { q, type, status, branch } = req.query;
  let results = [];
  const role = req.session.user.role;
  const userBranch = req.session.user.branch;
  if (q || type || status || branch) {
    let sql, params = [];
    if (q && q.trim()) {
      const fq = q.trim().split(/\s+/).map(t => t.replace(/[^\w]/g, '') + '*').filter(Boolean).join(' ');
      sql = `SELECT d.*, bm25(documents_fts) AS score FROM documents d
             JOIN documents_fts ON documents_fts.rowid = d.id
             WHERE documents_fts MATCH ?`;
      params.push(fq);
    } else {
      sql = 'SELECT *, 0 AS score FROM documents d WHERE 1=1';
    }
    if (type) { sql += ' AND d.doc_type = ?'; params.push(type); }
    if (status) { sql += ' AND d.status = ?'; params.push(status); }
    if (branch) { sql += ' AND d.branch = ?'; params.push(branch); }
    if (role === 'Viewer' && userBranch) { sql += ' AND d.branch = ?'; params.push(userBranch); }
    sql += q ? ' ORDER BY score LIMIT 100' : ' ORDER BY uploaded_at DESC LIMIT 100';
    try { results = db.prepare(sql).all(...params); } catch (e) { results = []; }
  }
  res.render('search', { active: 'search', results, query: req.query });
});

module.exports = router;

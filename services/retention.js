const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const db = require('../db');

function runPurge({ dryRun = false } = {}) {
  const policies = db.prepare('SELECT * FROM retention_policies WHERE auto_purge = 1').all();
  const results = [];
  policies.forEach(p => {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - p.retention_years);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    const candidates = db.prepare(
      "SELECT * FROM documents WHERE doc_type = ? AND uploaded_at < ?"
    ).all(p.doc_type, cutoffIso);
    candidates.forEach(doc => {
      results.push({ id: doc.id, type: doc.doc_type, name: doc.original_name, uploaded: doc.uploaded_at });
      if (!dryRun) {
        const fp = path.join(__dirname, '..', 'uploads', doc.filename);
        if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch(e){} }
        db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
      }
    });
  });
  if (!dryRun && results.length > 0) {
    db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)')
      .run('info', `Retention purge: ${results.length} document(s) removed`, 'Auto retention · policies applied');
  }
  console.log(`[retention] ${dryRun ? 'dry-run' : 'purge'}: ${results.length} affected`);
  return results;
}

function start() {
  cron.schedule('30 2 * * *', () => runPurge({ dryRun: false }));
  console.log('[retention] scheduled daily at 02:30');
}

module.exports = { start, runPurge };

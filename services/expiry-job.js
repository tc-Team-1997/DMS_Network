const cron = require('node-cron');
const db = require('../db');
const { broadcast } = require('./notify');

function scanExpiries() {
  const today = new Date();
  const in90 = new Date(today.getTime() + 90 * 86400000);
  const todayIso = today.toISOString().slice(0, 10);
  const in90Iso = in90.toISOString().slice(0, 10);

  const expired = db.prepare(
    "UPDATE documents SET status='Expired' WHERE expiry_date IS NOT NULL AND expiry_date < ? AND status != 'Expired'"
  ).run(todayIso);

  const expiring = db.prepare(
    "UPDATE documents SET status='Expiring' WHERE expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ? AND status NOT IN ('Expiring','Expired')"
  ).run(todayIso, in90Iso);

  if (expired.changes > 0) {
    const title = `${expired.changes} document(s) newly expired`;
    db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)')
      .run('critical', title, 'Auto scan · compliance risk');
    broadcast('Doc Admin', 'email', 'Document Expiry Alert', title);
  }
  if (expiring.changes > 0) {
    db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)')
      .run('warning', `${expiring.changes} document(s) expiring in <=90 days`, 'Auto scan');
  }
  console.log(`[expiry-job] expired=${expired.changes} expiring=${expiring.changes}`);
  return { expired: expired.changes, expiring: expiring.changes };
}

function start() {
  cron.schedule('0 2 * * *', scanExpiries);
  console.log('[expiry-job] scheduled daily at 02:00');
}

module.exports = { start, scanExpiries };

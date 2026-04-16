const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const ws = require('../services/ws');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'nbe-webhook-secret';

function verifySignature(req, res, next) {
  const sig = req.headers['x-webhook-signature'];
  if (!sig) return res.status(401).json({ error: 'Missing signature' });
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
  next();
}

router.post('/cbs/customer-updated', verifySignature, (req, res) => {
  const { cid, name, event } = req.body;
  const alert = db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)')
    .run('info', `CBS update: ${event||'customer updated'} - ${name||cid}`, `CID ${cid} · source: CBS`);
  ws.broadcast({ type: 'alert', level: 'info', title: `CBS: ${name||cid} updated`, id: alert.lastInsertRowid });
  res.json({ ok: true });
});

router.post('/los/loan-application', verifySignature, (req, res) => {
  const { ref, customer_name, amount } = req.body;
  const wf = db.prepare('INSERT INTO workflows (ref_code, title, stage, priority) VALUES (?,?,?,?)')
    .run('L' + Date.now().toString().slice(-4), `Loan App from LOS: ${customer_name}`, 'Maker Review', amount > 1000000 ? 'High' : 'Medium');
  const alert = db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)')
    .run('info', `New LOS loan application: ${customer_name}`, `Amount EGP ${amount||'?'} · ref ${ref}`);
  ws.broadcast({ type: 'workflow', workflow_id: wf.lastInsertRowid, title: `Loan: ${customer_name}` });
  res.json({ ok: true, workflow_id: wf.lastInsertRowid });
});

router.post('/kyc/verification-result', verifySignature, (req, res) => {
  const { doc_id, verified, confidence } = req.body;
  if (doc_id) {
    db.prepare('UPDATE documents SET ocr_confidence=? WHERE id=?').run(confidence || null, doc_id);
  }
  db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?,?,?)')
    .run(verified ? 'success' : 'warning', `KYC verification ${verified?'passed':'failed'}`, `Doc #${doc_id} · conf ${confidence||'-'}%`);
  ws.broadcast({ type: 'kyc', doc_id, verified });
  res.json({ ok: true });
});

module.exports = router;

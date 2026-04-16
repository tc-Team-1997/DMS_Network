const router = require('express').Router();
const db = require('../db');
const { toCsv, toXlsx } = require('../services/export');

router.get('/documents.csv', (req, res) => {
  const rows = db.prepare('SELECT id, original_name, doc_type, customer_cid, customer_name, doc_number, expiry_date, branch, status, version, uploaded_at FROM documents ORDER BY id DESC').all();
  const cols = ['id','original_name','doc_type','customer_cid','customer_name','doc_number','expiry_date','branch','status','version','uploaded_at'];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="documents.csv"');
  res.send(toCsv(rows, cols));
});

router.get('/documents.xlsx', async (req, res) => {
  const rows = db.prepare('SELECT id, original_name, doc_type, customer_cid, customer_name, doc_number, expiry_date, branch, status, version, uploaded_at FROM documents ORDER BY id DESC').all();
  const cols = ['id','original_name','doc_type','customer_cid','customer_name','doc_number','expiry_date','branch','status','version','uploaded_at'];
  const buf = await toXlsx(rows, cols, 'Documents');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="documents.xlsx"');
  res.send(Buffer.from(buf));
});

router.get('/audit.csv', (req, res) => {
  const rows = db.prepare('SELECT a.id, u.username, a.action, a.entity, a.entity_id, a.details, a.created_at FROM audit_log a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.id DESC').all();
  const cols = ['id','username','action','entity','entity_id','details','created_at'];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="audit.csv"');
  res.send(toCsv(rows, cols));
});

router.get('/expiring.csv', (req, res) => {
  const rows = db.prepare("SELECT id, original_name, customer_name, customer_cid, expiry_date, branch, status FROM documents WHERE status IN ('Expiring','Expired') ORDER BY expiry_date").all();
  const cols = ['id','original_name','customer_name','customer_cid','expiry_date','branch','status'];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="expiring.csv"');
  res.send(toCsv(rows, cols));
});

module.exports = router;

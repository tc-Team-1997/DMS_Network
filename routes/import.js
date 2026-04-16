const router = require('express').Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const db = require('../db');
const rbac = require('../services/rbac');

const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') });

router.get('/', rbac.require('index'), (req, res) => {
  res.render('import', { active: 'indexing', result: null });
});

router.post('/', rbac.require('index'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(req.file.path);
  const ws = wb.worksheets[0];
  const header = [];
  let inserted = 0, updated = 0, errors = [];

  ws.getRow(1).eachCell(c => header.push(String(c.value||'').trim()));
  const col = (name) => header.indexOf(name);

  const insertStmt = db.prepare(
    `INSERT INTO documents (filename, original_name, doc_type, customer_cid, customer_name, doc_number,
       dob, issue_date, expiry_date, issuing_authority, branch, status, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const updateStmt = db.prepare(
    `UPDATE documents SET doc_type=?, customer_name=?, doc_number=?, dob=?, issue_date=?,
       expiry_date=?, issuing_authority=?, branch=?, status=? WHERE customer_cid=?`
  );

  const today = new Date();
  for (let i = 2; i <= ws.rowCount; i++) {
    try {
      const row = ws.getRow(i);
      const cid = String(row.getCell(col('customer_cid')+1).value||'').trim();
      if (!cid) continue;
      const expiry = row.getCell(col('expiry_date')+1).value;
      const expiryIso = expiry instanceof Date ? expiry.toISOString().slice(0,10) : (expiry ? String(expiry).slice(0,10) : null);
      let status = 'Valid';
      if (expiryIso) {
        const days = (new Date(expiryIso) - today) / 86400000;
        if (days < 0) status = 'Expired'; else if (days < 90) status = 'Expiring';
      }
      const existing = db.prepare('SELECT id FROM documents WHERE customer_cid=?').get(cid);
      const vals = [
        String(row.getCell(col('doc_type')+1).value||''),
        String(row.getCell(col('customer_name')+1).value||''),
        String(row.getCell(col('doc_number')+1).value||''),
        row.getCell(col('dob')+1).value ? String(row.getCell(col('dob')+1).value).slice(0,10) : null,
        row.getCell(col('issue_date')+1).value ? String(row.getCell(col('issue_date')+1).value).slice(0,10) : null,
        expiryIso,
        String(row.getCell(col('issuing_authority')+1).value||''),
        String(row.getCell(col('branch')+1).value||''),
        status
      ];
      if (existing) {
        updateStmt.run(...vals, cid);
        updated++;
      } else {
        insertStmt.run(`import-${Date.now()}-${i}.meta`, `ImportedRecord_${cid}`,
          vals[0], cid, vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], vals[7], vals[8], req.session.user.id);
        inserted++;
      }
    } catch (e) {
      errors.push(`Row ${i}: ${e.message}`);
    }
  }
  db.prepare('INSERT INTO audit_log (user_id, action, entity, details) VALUES (?,?,?,?)')
    .run(req.session.user.id, 'IMPORT', 'document', `+${inserted} ~${updated} err:${errors.length}`);
  res.render('import', { active: 'indexing', result: { inserted, updated, errors } });
});

router.get('/template', (req, res) => {
  const header = 'customer_cid,customer_name,doc_type,doc_number,dob,issue_date,expiry_date,issuing_authority,branch\n';
  const sample = 'EGY-2024-99991,Sample Customer,Passport,A99999999,1990-01-15,2023-01-01,2033-01-01,Civil Authority,Cairo West\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="import-template.csv"');
  res.send(header + sample);
});

module.exports = router;

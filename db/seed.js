const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(__dirname, 'nbe-dms.db'));
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  const insertUser = db.prepare(
    `INSERT INTO users (username, password, full_name, role, branch, mfa_enabled, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertUser.run('admin', hash, 'Ahmed Mohamed', 'Doc Admin', 'Cairo West', 1, 'Active');
  insertUser.run('sara', bcrypt.hashSync('sara123', 10), 'Sara Kamal', 'Maker', 'Giza', 1, 'Active');
  insertUser.run('mohamed', bcrypt.hashSync('mohamed123', 10), 'Mohamed Aly', 'Checker', 'Alexandria', 0, 'Active');
  insertUser.run('nour', bcrypt.hashSync('nour123', 10), 'Nour Rashid', 'Viewer', 'Cairo East', 1, 'Locked');

  const insertFolder = db.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)');
  const kyc = insertFolder.run('KYC Documents', null).lastInsertRowid;
  insertFolder.run('Passports', kyc);
  insertFolder.run('National IDs', kyc);
  insertFolder.run('Utility Bills', kyc);
  insertFolder.run('Loan Applications', null);
  insertFolder.run('Contracts', null);
  insertFolder.run('Compliance', null);
  insertFolder.run('Archived', null);

  const insertDoc = db.prepare(
    `INSERT INTO documents (filename, original_name, doc_type, customer_cid, customer_name, doc_number,
       expiry_date, branch, folder_id, status, version, size, mime_type, ocr_confidence, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertDoc.run('Passport_AHI_2022.pdf', 'Passport_AHI_2022.pdf', 'Passport', 'EGY-2024-00847', 'Ahmed H. Ibrahim', 'A12345678', '2032-01-09', 'Cairo West', 2, 'Valid', 'v2.0', 1880000, 'application/pdf', 97.2, 1);
  insertDoc.run('Passport_SMK_2021.pdf', 'Passport_SMK_2021.pdf', 'Passport', 'EGY-2024-00848', 'Sara M. Kamal', 'B87654321', '2026-03-15', 'Giza', 2, 'Expiring', 'v1.0', 1240000, 'application/pdf', 94.1, 2);
  insertDoc.run('Passport_NKR_2019.pdf', 'Passport_NKR_2019.pdf', 'Passport', 'EGY-2024-00849', 'Nour K. Rashid', 'C55512345', '2024-12-02', 'Cairo East', 2, 'Expired', 'v3.1', 2010000, 'application/pdf', 91.5, 1);

  const insertWf = db.prepare(
    `INSERT INTO workflows (ref_code, title, doc_id, stage, priority) VALUES (?, ?, ?, ?, ?)`
  );
  insertWf.run('K4829', 'KYC Approval #K4829', 1, 'Maker Review', 'High');
  insertWf.run('L0341', 'Loan App #L0341', null, 'Manager Sign-off', 'Medium');
  insertWf.run('C8822', 'Contract #C8822', null, 'Legal Review', 'Low');
  insertWf.run('CP22', 'Compliance #CP22', null, 'Rejected - Rework', 'High');

  const insertAlert = db.prepare('INSERT INTO alerts (level, title, meta) VALUES (?, ?, ?)');
  insertAlert.run('critical', '42 KYC documents expired - compliance breach risk', 'Auto-generated · Escalated to Branch Managers');
  insertAlert.run('warning', '245 passports expiring within 90 days', 'Daily 7:00 AM · SMS sent to customers');
  insertAlert.run('info', 'AI batch processing complete - 342 documents indexed', 'System alert · 3 min ago');
  insertAlert.run('success', 'Workflow #K4829 approved by Checker', 'Workflow alert · 1 hr ago');

  const insertRet = db.prepare('INSERT OR IGNORE INTO retention_policies (doc_type, retention_years, auto_purge) VALUES (?,?,?)');
  insertRet.run('Passport', 10, 0);
  insertRet.run('National ID', 10, 0);
  insertRet.run('Loan Application', 7, 0);
  insertRet.run('Contract', 7, 0);
  insertRet.run('Utility Bill', 5, 1);
  insertRet.run('Temp', 1, 1);


  const insertTpl = db.prepare('INSERT INTO workflow_templates (name, doc_type, steps_json) VALUES (?,?,?)');
  insertTpl.run('KYC Standard', 'Passport', JSON.stringify([
    { id: 1, name: 'Capture', role: 'Maker' },
    { id: 2, name: 'AI Index', role: 'system' },
    { id: 3, name: 'Maker Review', role: 'Maker' },
    { id: 4, name: 'Checker', role: 'Checker' },
    { id: 5, name: 'Approve', role: 'Doc Admin' },
    { id: 6, name: 'Archive', role: 'system' }
  ]));
  insertTpl.run('Loan Fast-track', 'Loan Application', JSON.stringify([
    { id: 1, name: 'Capture', role: 'Maker' },
    { id: 2, name: 'Manager Sign-off', role: 'Checker' },
    { id: 3, name: 'Archive', role: 'system' }
  ]));

  console.log('Seed complete. Login: admin / admin123');
} else {
  console.log('DB already seeded.');
}
db.close();

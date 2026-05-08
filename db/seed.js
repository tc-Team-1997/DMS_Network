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

// ---------------------------------------------------------------------------
// BRD #20 — Saved Searches (idempotent)
// ---------------------------------------------------------------------------
const savedSearchCount = db.prepare('SELECT COUNT(*) c FROM saved_searches').get().c;
if (savedSearchCount === 0) {
  const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").get()?.id;
  if (adminId) {
    const insertSS = db.prepare(
      `INSERT INTO saved_searches (user_id, name, query_json, scope, tenant_id)
       VALUES (?, ?, ?, ?, 'nbe')`
    );
    insertSS.run(
      adminId,
      'Expiring passports',
      JSON.stringify({ doc_type: 'Passport', status: 'Expiring', expiry_within_days: 90 }),
      'private'
    );
    insertSS.run(
      adminId,
      'Pending KYC',
      JSON.stringify({ doc_type: 'Passport', workflow_stage: 'Maker Review' }),
      'public'
    );
    console.log('Saved searches seeded (2 rows).');
  }
}

// ---------------------------------------------------------------------------
// BRD #26 — User Dashboards (idempotent)
// ---------------------------------------------------------------------------
const dashboardCount = db.prepare('SELECT COUNT(*) c FROM user_dashboards').get().c;
if (dashboardCount === 0) {
  const baseLayout = JSON.stringify([
    { i: 'metric-total',    x: 0, y: 0, w: 3, h: 2, component: 'MetricCard', props: { label: 'Total Documents',   metric: 'total_documents'   } },
    { i: 'metric-expiring', x: 3, y: 0, w: 3, h: 2, component: 'MetricCard', props: { label: 'Expiring Soon',     metric: 'expiring_soon'     } },
    { i: 'metric-pending',  x: 6, y: 0, w: 3, h: 2, component: 'MetricCard', props: { label: 'Pending Workflows', metric: 'pending_workflows' } },
    { i: 'metric-alerts',   x: 9, y: 0, w: 3, h: 2, component: 'MetricCard', props: { label: 'Critical Alerts',   metric: 'critical_alerts'   } }
  ]);
  const insertDash = db.prepare(
    `INSERT INTO user_dashboards (user_id, name, layout_json, is_default, tenant_id)
     VALUES (?, 'My Dashboard', ?, 1, 'nbe')`
  );
  for (const uname of ['admin', 'sara', 'mohamed', 'nour']) {
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
    if (row) insertDash.run(row.id, baseLayout);
  }
  console.log('User dashboards seeded (4 rows).');
}

// ---------------------------------------------------------------------------
// BRD #15 — Folder Permissions (idempotent)
// ---------------------------------------------------------------------------
const folderPermCount = db.prepare('SELECT COUNT(*) c FROM folder_perms').get().c;
if (folderPermCount === 0) {
  const folderIds = db.prepare('SELECT id FROM folders').all().map(r => r.id);
  const insertFP = db.prepare(
    `INSERT OR IGNORE INTO folder_perms (folder_id, role, can_view, can_edit, can_delete, tenant_id)
     VALUES (?, ?, ?, ?, ?, 'nbe')`
  );
  // role matrix: [role, can_view, can_edit, can_delete]
  const roleMatrix = [
    ['Doc Admin', 1, 1, 1],
    ['Maker',     1, 1, 0],
    ['Checker',   1, 0, 0],
    ['Viewer',    1, 0, 0],
  ];
  for (const fid of folderIds) {
    for (const [role, v, e, d] of roleMatrix) {
      insertFP.run(fid, role, v, e, d);
    }
  }
  console.log(`Folder perms seeded (${folderIds.length * roleMatrix.length} rows).`);
}

// Glossary seed runs independently of the user seed so existing DBs get the
// starter entries on the next `node db/seed.js`. The INSERT OR IGNORE keeps
// it idempotent (UNIQUE on tenant_id+term).
const glossaryCount = db.prepare('SELECT COUNT(*) c FROM ai_glossary_terms').get().c;
if (glossaryCount === 0) {
  const insertTerm = db.prepare(
    `INSERT OR IGNORE INTO ai_glossary_terms
       (term, definition, synonyms_json, table_hint, column_hint, sql_template, category, source, approved)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'auto', 1)`
  );
  const seed = [
    // Column-level entries — give the agent vocabulary for raw fields.
    ['Document',           'Any file stored in the DMS (PDF, image, office doc).', ['file', 'record'], 'documents', null, null, 'entity'],
    ['Document type',      'Classification label for a document such as Passport, National ID, Contract.', ['doc type', 'category', 'kind'], 'documents', 'doc_type', null, 'column'],
    ['Branch',             'Bank branch that owns a document or workflow.', ['office', 'location'], 'documents', 'branch', null, 'column'],
    ['Customer CID',       'Unique national customer identifier.', ['customer id', 'cid', 'national id'], 'documents', 'customer_cid', null, 'column'],
    ['Expiry date',        'The date when a document ceases to be valid.', ['expires', 'valid until'], 'documents', 'expiry_date', null, 'column'],
    ['Upload date',        'Timestamp when the file was first uploaded.', ['uploaded_at', 'ingested', 'received'], 'documents', 'uploaded_at', null, 'column'],
    // Business metrics — precomposed SQL snippets the agent can compose into a query.
    ['Pending documents',  'Documents that have not been approved yet (workflow stage other than Approved).', ['in review', 'awaiting approval'], 'documents', 'status', "status != 'Valid'", 'metric'],
    ['Processed documents','Documents ingested, classified and indexed by the AI pipeline.', ['indexed', 'ingested'], 'documents', null, "status IN ('Valid','Expiring','Expired','Archived')", 'metric'],
    ['Expiring soon',      'Documents whose expiry_date falls within the next 30 days.', ['expiring', 'about to expire'], 'documents', 'expiry_date', "expiry_date BETWEEN date('now') AND date('now','+30 day')", 'metric'],
    ['Recently uploaded',  'Documents uploaded within a rolling time window (default 7 days).', ['new uploads', 'latest documents'], 'documents', 'uploaded_at', "uploaded_at >= datetime('now','-7 day')", 'metric'],
    ['Open workflows',     'Workflow instances still in a non-terminal stage.', ['pending reviews', 'in progress'], 'workflows', 'stage', "stage NOT IN ('Approved','Rejected - Rework','Archived')", 'metric'],
    ['Critical alerts',    'Alerts with level = critical, usually compliance or retention breaches.', ['compliance alerts'], 'alerts', 'level', "level = 'critical'", 'metric'],
  ];
  for (const [term, def, syn, tbl, col, tpl, cat] of seed) {
    insertTerm.run(term, def, JSON.stringify(syn), tbl, col, tpl, cat);
  }
  console.log(`Glossary seeded (${seed.length} terms).`);
}

// ---------------------------------------------------------------------------
// Migration 0018 — document_type_schemas new columns + document_type_samples
// Each ALTER TABLE is wrapped in try/catch so the script stays idempotent
// on DBs that were re-created from the updated schema.sql (where the columns
// already exist) as well as on legacy DBs that need the backfill.
// ---------------------------------------------------------------------------
const newSchemaColumns = [
  "ALTER TABLE document_type_schemas ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE document_type_schemas ADD COLUMN inference_status TEXT NOT NULL DEFAULT 'pending'",
  "ALTER TABLE document_type_schemas ADD COLUMN source_samples_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE document_type_schemas ADD COLUMN vector_index_version INTEGER NOT NULL DEFAULT 0",
];
for (const ddl of newSchemaColumns) {
  try { db.exec(ddl); } catch (_) { /* column already exists — skip */ }
}

// Seed canonical banking doc-type schemas with ai_extract_from so DocBrain
// can auto-fill the Capture form after vision OCR + entity extraction.
// Idempotent via INSERT OR IGNORE (name is UNIQUE).
const insertDoctype = db.prepare(
  `INSERT OR IGNORE INTO document_type_schemas
     (name, description, fields_json, active, tenant_id, schema_version, inference_status,
      source_samples_count, vector_index_version)
   VALUES (?, ?, ?, 1, 'nbe', 1, 'live', 0, 0)`
);

const idFields = [
  { key: 'customer_name',     label: 'Full Name',         type: 'text', required: true,  ai_extract_from: 'customer_name' },
  { key: 'customer_cid',      label: 'National CID',      type: 'text', required: true,  ai_extract_from: 'customer_cid' },
  { key: 'doc_number',        label: 'Card Number',       type: 'text', required: false, ai_extract_from: 'doc_number' },
  { key: 'dob',               label: 'Date of Birth',     type: 'date', required: false, ai_extract_from: 'dob' },
  { key: 'issue_date',        label: 'Issue Date',        type: 'date', required: false, ai_extract_from: 'issue_date' },
  { key: 'expiry_date',       label: 'Expiry Date',       type: 'date', required: true,  ai_extract_from: 'expiry_date' },
  { key: 'issuing_authority', label: 'Issuing Authority', type: 'text', required: false, ai_extract_from: 'issuing_authority' },
  { key: 'address',           label: 'Address',           type: 'textarea', required: false, ai_extract_from: 'address' },
];

insertDoctype.run('National ID',     'Citizen identity card / CID.',                JSON.stringify(idFields));
insertDoctype.run('Passport',        'Machine-readable travel document.',           JSON.stringify(idFields));
insertDoctype.run('Driving Licence', 'Government-issued driving permit.',           JSON.stringify(idFields));

insertDoctype.run('Utility Bill',
  'Address proof — electricity, water, phone, internet bill.',
  JSON.stringify([
    { key: 'customer_name',  label: 'Account Holder',    type: 'text',   required: true,  ai_extract_from: 'customer_name' },
    { key: 'customer_cid',   label: 'Customer CID',      type: 'text',   required: false, ai_extract_from: 'customer_cid' },
    { key: 'doc_number',     label: 'Bill / Account #',  type: 'text',   required: false, ai_extract_from: 'doc_number' },
    { key: 'issue_date',     label: 'Bill Date',         type: 'date',   required: true,  ai_extract_from: 'issue_date' },
    { key: 'address',        label: 'Service Address',   type: 'textarea', required: true, ai_extract_from: 'address' },
    { key: 'issuing_authority', label: 'Utility Provider', type: 'text', required: false, ai_extract_from: 'issuing_authority' },
  ]));

insertDoctype.run('Salary Certificate',
  'Employer-issued proof of salary / employment.',
  JSON.stringify([
    { key: 'customer_name',  label: 'Employee Name',   type: 'text', required: true,  ai_extract_from: 'customer_name' },
    { key: 'customer_cid',   label: 'Employee CID',    type: 'text', required: false, ai_extract_from: 'customer_cid' },
    { key: 'doc_number',     label: 'Certificate #',   type: 'text', required: false, ai_extract_from: 'doc_number' },
    { key: 'issue_date',     label: 'Issue Date',      type: 'date', required: true,  ai_extract_from: 'issue_date' },
    { key: 'issuing_authority', label: 'Employer',     type: 'text', required: true,  ai_extract_from: 'issuing_authority' },
  ]));

insertDoctype.run('Bank Statement',
  'Account statement from another bank (address + activity proof).',
  JSON.stringify([
    { key: 'customer_name',  label: 'Account Holder',  type: 'text', required: true,  ai_extract_from: 'customer_name' },
    { key: 'customer_cid',   label: 'Customer CID',    type: 'text', required: false, ai_extract_from: 'customer_cid' },
    { key: 'doc_number',     label: 'Account #',       type: 'text', required: true,  ai_extract_from: 'doc_number' },
    { key: 'issue_date',     label: 'Statement Date',  type: 'date', required: true,  ai_extract_from: 'issue_date' },
    { key: 'address',        label: 'Address on File', type: 'textarea', required: false, ai_extract_from: 'address' },
    { key: 'issuing_authority', label: 'Bank Name',    type: 'text', required: false, ai_extract_from: 'issuing_authority' },
  ]));

insertDoctype.run('KYC',
  'KYC onboarding packet — catch-all when specific ID type is unknown.',
  JSON.stringify([
    { key: 'customer_name',  label: 'Customer Name',   type: 'text', required: true,  ai_extract_from: 'customer_name' },
    { key: 'customer_cid',   label: 'Customer CID',    type: 'text', required: true,  ai_extract_from: 'customer_cid' },
    { key: 'doc_number',     label: 'Document Number', type: 'text', required: true,  ai_extract_from: 'doc_number' },
    { key: 'dob',            label: 'Date of Birth',   type: 'date', required: false, ai_extract_from: 'dob' },
    { key: 'expiry_date',    label: 'Expiry Date',     type: 'date', required: false, ai_extract_from: 'expiry_date' },
  ]));

// Ensure placeholder sample files exist so the UI can render thumbnails.
const uploadsDir = path.join(__dirname, '..', 'uploads', 'tmp');
fs.mkdirSync(uploadsDir, { recursive: true });
const sampleFiles = [
  'kyc_sample_01.jpeg',
  'kyc_sample_02.jpeg',
];
for (const fname of sampleFiles) {
  const fpath = path.join(uploadsDir, fname);
  if (!fs.existsSync(fpath)) fs.writeFileSync(fpath, '');
}

// Seed 2 sample rows pointing at the placeholder files (idempotent via UNIQUE).
const kycSchema = db.prepare("SELECT id FROM document_type_schemas WHERE name = 'KYC'").get();
if (kycSchema) {
  const adminRow = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  const uploadedBy = adminRow ? adminRow.id : null;
  const insertSample = db.prepare(
    `INSERT OR IGNORE INTO document_type_samples
       (schema_id, file_path, sha256, label, notes, uploaded_by, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, 'nbe')`
  );
  insertSample.run(
    kycSchema.id,
    `uploads/tmp/kyc_sample_01.jpeg`,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // SHA-256 of empty file
    'KYC sample 01',
    'Placeholder — replace with a real reference document.',
    uploadedBy
  );
  insertSample.run(
    kycSchema.id,
    `uploads/tmp/kyc_sample_02.jpeg`,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856', // distinct sentinel sha256
    'KYC sample 02',
    'Placeholder — replace with a real reference document.',
    uploadedBy
  );
  const sampleCount = db.prepare('SELECT COUNT(*) c FROM document_type_samples').get().c;
  console.log(`DocType samples seeded (${sampleCount} total rows).`);
}

// ---------------------------------------------------------------------------
// Req 44-45 — Dedup settings (idempotent via INSERT OR IGNORE)
// ---------------------------------------------------------------------------
db.prepare(
  `INSERT OR IGNORE INTO dedup_settings (tenant_id) VALUES ('nbe')`
).run();
console.log('Dedup settings seeded (tenant nbe).');

db.close();

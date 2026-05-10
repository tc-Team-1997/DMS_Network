// Production guard — refuse to run in production unless explicitly overridden.
if (process.env.NODE_ENV === 'production' && !process.env.DMS_FORCE_SEED) {
  console.error('[seed] refused to run in production. Use db/tenant-init.js to bootstrap a real tenant.');
  process.exit(1);
}

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

// ---------------------------------------------------------------------------
// Migration 0033 — BoB Business Calendar (idempotent)
// Only runs when business_calendars table exists (created by db/index.js boot-migration).
// ---------------------------------------------------------------------------
try {
  const bobCalCount = db.prepare(
    "SELECT COUNT(*) c FROM business_calendars WHERE tenant_id = 'bob' AND name = 'Bank of Bhutan — Standard'"
  ).get().c;
  if (bobCalCount === 0) {
    const bobHolidays = [
      '2026-01-02',
      '2026-02-21',
      '2026-02-25',
      '2026-05-02',
      '2026-06-02',
      '2026-09-22',
      '2026-10-13',
      '2026-10-15',
      '2026-10-16',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-12-17',
    ];
    const bobHours = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', tz: 'Asia/Thimphu' };
    db.prepare(
      `INSERT OR IGNORE INTO business_calendars
         (tenant_id, name, holidays_json, business_hours_json)
       VALUES ('bob', 'Bank of Bhutan — Standard', ?, ?)`
    ).run(JSON.stringify(bobHolidays), JSON.stringify(bobHours));
    console.log('BoB business calendar seeded.');
  }
} catch {
  // Table not yet created (older DB without migration 0033); skip gracefully.
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

insertDoctype.run('Loan Application',
  'Retail or corporate loan application form.',
  JSON.stringify([
    { key: 'customer_name',  label: 'Applicant Name',  type: 'text', required: true,  ai_extract_from: 'customer_name' },
    { key: 'customer_cid',   label: 'Applicant CID',   type: 'text', required: true,  ai_extract_from: 'customer_cid' },
    { key: 'doc_number',     label: 'Application #',   type: 'text', required: false, ai_extract_from: 'doc_number' },
    { key: 'issue_date',     label: 'Application Date', type: 'date', required: true,  ai_extract_from: 'issue_date' },
    { key: 'address',        label: 'Address',         type: 'textarea', required: false, ai_extract_from: 'address' },
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

// ---------------------------------------------------------------------------
// CBS Temenos T24 linkage — demo row so the "Linked to T24" indicator has
// data to render on a fresh clone (BHU-48 Phase 2, migration 0022).
//
// The idempotency_key is a stable SHA-256 hex digest of the string
// "nbe|1|T24-TXN-DEMO-001" — pre-computed so the seed is deterministic
// without requiring the crypto module at seed time.
//
// Idempotent via INSERT OR IGNORE (UNIQUE on tenant_id + idempotency_key).
// ---------------------------------------------------------------------------
const cbsLinkDoc = db.prepare("SELECT id FROM documents LIMIT 1").get();
const cbsLinkUser = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (cbsLinkDoc && cbsLinkUser) {
  db.prepare(
    `INSERT OR IGNORE INTO cbs_document_links
       (tenant_id, cif, document_id, transaction_ref, transaction_type,
        idempotency_key, linked_by, linked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    'nbe',
    'EGY-2024-00847',
    cbsLinkDoc.id,
    'T24-TXN-DEMO-001',
    'kyc-update',
    // SHA-256("nbe|1|T24-TXN-DEMO-001") — pre-computed sentinel
    'a3f1d8e2c74b9056f2e30a1d5b8c7e4f9d2a6b3c1e5f8a2d4b7c0e3f6a9b2d5',
    cbsLinkUser.id,
  );
  const cbsLinkCount = db.prepare('SELECT COUNT(*) c FROM cbs_document_links').get().c;
  console.log(`CBS document links seeded (${cbsLinkCount} total rows).`);
}

// ---------------------------------------------------------------------------
// CC1 — Tenant registry seed (idempotent via INSERT OR IGNORE)
// tenant_id='nbe' is the historical identifier preserved across all existing
// rows. display_name='Bank of Bhutan' surfaces in the UI so users never see
// the internal 'nbe' slug.
//
// Wave D: also seed tenant_id='bob' as the canonical fresh-install tenant so
// new deployments boot with 'bob' as the active tenant. The 'nbe' row stays
// for backward compatibility of all existing tenant_config partition keys.
// ---------------------------------------------------------------------------
db.prepare(
  `INSERT OR IGNORE INTO tenants
     (tenant_id, slug, display_name, regulator_name, regulator_short,
      default_locale, allowed_locales, primary_color, monogram, is_active)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
).run(
  'nbe',
  'bob',
  'Bank of Bhutan',
  'Royal Monetary Authority',
  'RMA',
  'en',
  '["en","dz"]',
  '#1B3A6B',
  'BoB'
);
console.log('Tenant seeded (nbe / Bank of Bhutan).');

// Seed 'bob' as a canonical tenant_id alias for fresh installs.
// Skipped on installs where tenant_id='nbe' already represents Bank of Bhutan
// (the slug 'bob' is UNIQUE so re-using it would conflict). The 'nbe' row above
// already carries display_name='Bank of Bhutan'; the canonical 'bob' tenant_id
// is reserved for fresh installs that have never had an 'nbe' row.
const hasNbeTenant = db
  .prepare("SELECT 1 FROM tenants WHERE tenant_id = 'nbe'")
  .get();
if (!hasNbeTenant) {
  db.prepare(
    `INSERT OR IGNORE INTO tenants
       (tenant_id, slug, display_name, regulator_name, regulator_short,
        default_locale, allowed_locales, primary_color, monogram, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    'bob',
    'bob',
    'Bank of Bhutan',
    'Royal Monetary Authority',
    'RMA',
    'dz-BT',
    '["en","dz"]',
    '#1B3A6B',
    'BoB'
  );
  console.log('Tenant seeded (bob / Bank of Bhutan — canonical fresh-install default).');
}

// ---------------------------------------------------------------------------
// Wave D — BoB branding tenant_config (idempotent via INSERT OR IGNORE).
// Seeds the 'branding' namespace for the 'nbe' tenant with concrete BoB values
// so the login screen, topbar, sidebar, and error pages all reflect BoB
// identity without any admin Settings intervention on a fresh install.
// ---------------------------------------------------------------------------
const bobBrandingConfig = [
  ['product_name',              '"DocManager"'],
  ['tagline',                   '"Document Operations for Bank of Bhutan"'],
  ['welcome_message',           '"Welcome to {product_name}"'],
  ['subtitle',                  '"{tenant_display_name} — Document Operations"'],
  ['login_logo_url',            '"/branding/bob-logo.svg"'],
  ['footer_copyright',          '"© {year} {tenant_display_name}. All rights reserved."'],
  ['support_email',             '"support@bob.bt"'],
  ['support_phone',             '"+975 2 322777"'],
  ['theme_mode',                '"light"'],
  ['primary_color',             '"#1B3A6B"'],
  ['monogram',                  '"BoB"'],
];

const insertBobBranding = db.prepare(
  `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
   VALUES ('nbe', 'branding', ?, ?, 1, datetime('now'))`
);
for (const [key, value] of bobBrandingConfig) {
  insertBobBranding.run(key, value);
}
// Also seed for the canonical 'bob' tenant_id when it exists (fresh installs).
const hasBobTenant = db
  .prepare("SELECT 1 FROM tenants WHERE tenant_id = 'bob'")
  .get();
if (hasBobTenant) {
  const insertBobBrandingCanonical = db.prepare(
    `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
     VALUES ('bob', 'branding', ?, ?, 1, datetime('now'))`
  );
  for (const [key, value] of bobBrandingConfig) {
    insertBobBrandingCanonical.run(key, value);
  }
}
console.log(`BoB branding tenant_config seeded (${bobBrandingConfig.length} keys).`);

// ---------------------------------------------------------------------------
// Migration 0028 — wf_actions table (idempotent boot-time CREATE via schema.sql
// already handled above via db.exec(schema)).  No ALTER needed — new table.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Migration 0032 — DocTypes v2: new columns on existing tables.
// The new doctype_versions + doctype_field_bbox tables are created via
// schema.sql above (CREATE TABLE IF NOT EXISTS). Only the ALTER TABLE
// statements need the try/catch guard for idempotency on existing DBs.
// ---------------------------------------------------------------------------
const doctype0032Alters = [
  "ALTER TABLE document_type_schemas ADD COLUMN notify_days TEXT NOT NULL DEFAULT '30,60,90'",
  "ALTER TABLE document_type_schemas ADD COLUMN translate_extracted_to_dz INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE workflows ADD COLUMN doctype_version_id INTEGER REFERENCES doctype_versions(id)",
];
for (const ddl of doctype0032Alters) {
  try { db.exec(ddl); } catch (_) { /* column already exists — skip */ }
}
console.log('Migration 0032 (DocTypes v2) columns applied.');

// ---------------------------------------------------------------------------
// Workflows v2 — tenant_config namespace 'workflows' defaults (idempotent).
// Each key uses INSERT OR IGNORE so a re-seed never stomps admin edits.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Capture v2 — tenant_config namespace 'capture' defaults (idempotent).
// Each key uses INSERT OR IGNORE so a re-seed never stomps admin edits.
// ---------------------------------------------------------------------------
const captureConfigDefaults = [
  ['allowed_mime_types',             JSON.stringify(['application/pdf','image/jpeg','image/png','image/tiff','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])],
  ['max_file_size_mb',               '50'],
  ['batch_limit',                    '25'],
  ['dedup.sha_exact_enabled',        'true'],
  ['dedup.phash_enabled',            'true'],
  ['dedup.phash_max_distance',       '10'],
  ['dedup.fuzzy_enabled',            'true'],
  ['dedup.fuzzy_min_ratio',          '0.8'],
  ['camera_capture_enabled',         'true'],
  ['scanner_import_enabled',         'false'],
  ['auto_classify_enabled',          'true'],
  ['auto_link_to_cif_policy',        '"exact_only"'],
  ['extraction_confidence_floor_low',  '0.4'],
  ['extraction_confidence_floor_high', '0.7'],
];

const insertCaptureConfig = db.prepare(
  `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
   VALUES ('nbe', 'capture', ?, ?, 1, datetime('now'))`
);
for (const [key, value] of captureConfigDefaults) {
  insertCaptureConfig.run(key, value);
}

// Also seed for Bank of Bhutan (bhu) tenant if it exists.
const bhuExists = db.prepare("SELECT COUNT(*) c FROM users WHERE tenant_id = 'bhu'").get().c > 0
  || db.prepare("SELECT COUNT(*) c FROM tenant_config WHERE tenant_id = 'bhu'").get().c > 0;
if (bhuExists) {
  const insertBhuCapture = db.prepare(
    `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
     VALUES ('bhu', 'capture', ?, ?, 1, datetime('now'))`
  );
  for (const [key, value] of captureConfigDefaults) {
    insertBhuCapture.run(key, value);
  }
}

console.log(`Capture tenant_config seeded (${captureConfigDefaults.length} keys).`);

// ---------------------------------------------------------------------------
// Workflows v2 — tenant_config namespace 'workflows' defaults (idempotent).
// Each key uses INSERT OR IGNORE so a re-seed never stomps admin edits.
// ---------------------------------------------------------------------------
const wfConfigDefaults = [
  ['reason_codes.approve',  JSON.stringify(['Compliant', 'Verified', 'Meets policy', 'Risk accepted'])],
  ['reason_codes.reject',   JSON.stringify(['Incomplete documentation', 'Data mismatch', 'Expired document', 'Duplicate submission', 'Policy violation'])],
  ['reason_codes.escalate', JSON.stringify(['Requires branch manager review', 'Compliance escalation', 'AML flag', 'Unusual amount'])],
  ['min_comment_length',    '20'],
  ['step_up_risk_band',     '"high"'],
  ['step_up_amount_threshold', '500000'],
  ['escalation_targets',    JSON.stringify(['Branch Manager', 'Compliance Officer', 'Head of KYC', 'Chief Risk Officer'])],
  ['sla_breach_action',     '"notify"'],
  ['bulk_action_max',       '50'],
];

const insertWfConfig = db.prepare(
  `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
   VALUES ('nbe', 'workflows', ?, ?, 1, datetime('now'))`
);
for (const [key, value] of wfConfigDefaults) {
  insertWfConfig.run(key, value);
}
console.log(`Workflows tenant_config seeded (${wfConfigDefaults.length} keys).`);

// ---------------------------------------------------------------------------
// Migration 0032 — tenant_config namespace 'doctypes' defaults (idempotent).
// ---------------------------------------------------------------------------
const doctypesConfigDefaults = [
  ['ocr_engine',                 '"tesseract"'],
  ['classification_model',       '"docbrain-v1"'],
  ['confidence_floor_low',       '0.4'],
  ['confidence_floor_high',      '0.7'],
  ['notify_days',                '"30,60,90"'],
  ['retention_days',             '3650'],
  ['worm_eligible',              'false'],
  ['translate_extracted_to_dz',  'false'],
  ['schema_versioning',          'true'],
  ['ab_test_sample_size',        '10'],
];

const insertDoctypesConfig = db.prepare(
  `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
   VALUES ('nbe', 'doctypes', ?, ?, 1, datetime('now'))`
);
for (const [key, value] of doctypesConfigDefaults) {
  insertDoctypesConfig.run(key, value);
}
console.log(`DocTypes tenant_config seeded (${doctypesConfigDefaults.length} keys).`);

// ---------------------------------------------------------------------------
// Migration 0031 — Users v2
// 1. Make users.password nullable (rename-recreate-copy-drop — SQLite pattern).
// 2. Add users.mfa_phone if absent.
// 3. user_invites + saml_idps are created above via schema.sql (IF NOT EXISTS).
// 4. Seed auth + rbac + _user_meta namespace defaults.
// ---------------------------------------------------------------------------

// 0031-a: make users.password nullable (detect by sqlite_master definition).
const usersTableDef = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
).get();
const passwordNullable = usersTableDef && !usersTableDef.sql.includes('password TEXT NOT NULL');
if (!passwordNullable && usersTableDef) {
  // Rename → recreate nullable → copy → drop old.
  db.exec(`
    ALTER TABLE users RENAME TO _users_old_0031;

    CREATE TABLE users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT,
      full_name  TEXT,
      email      TEXT,
      role       TEXT DEFAULT 'Viewer',
      branch     TEXT,
      mfa_enabled INTEGER DEFAULT 0,
      mfa_secret TEXT,
      mfa_phone  TEXT,
      status     TEXT DEFAULT 'Active',
      api_key    TEXT,
      tenant_id  TEXT DEFAULT 'nbe',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO users
      (id, username, password, full_name, email, role, branch,
       mfa_enabled, mfa_secret, status, api_key, tenant_id, created_at)
    SELECT
      id, username, password, full_name, email, role, branch,
      mfa_enabled, mfa_secret, status, api_key, tenant_id, created_at
    FROM _users_old_0031;

    DROP TABLE _users_old_0031;
  `);
  console.log('Migration 0031: users.password made nullable, mfa_phone added.');
}

// 0031-b: add mfa_phone if this is a fresh post-0031 table that already exists
// without the column (e.g. DB created before mfa_phone was in schema.sql).
try {
  db.exec("ALTER TABLE users ADD COLUMN mfa_phone TEXT");
  console.log('Migration 0031: users.mfa_phone column added.');
} catch (_) { /* already exists */ }

// 0031-c: seed auth namespace defaults (idempotent via INSERT OR IGNORE).
const authConfigDefaults = [
  ['magic_link_ttl_hours',  '168'],
  ['password_min_length',   '10'],
  ['password_history_count','5'],
  ['force_mfa_for_role',    '{"Maker":false,"Checker":false,"Doc Admin":false,"Viewer":false}'],
  ['force_sso_for_tenant',  '"false"'],
];
const insertAuthConfig = db.prepare(
  `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
   VALUES ('nbe', 'auth', ?, ?, 1, datetime('now'))`
);
for (const [key, value] of authConfigDefaults) {
  insertAuthConfig.run(key, value);
}
console.log(`Auth tenant_config seeded (${authConfigDefaults.length} keys).`);

// 0031-d: seed rbac namespace defaults (idempotent via INSERT OR IGNORE).
const rbacConfigDefaults = [
  ['session_ttl_minutes', '120'],
  ['sod_forbidden_pairs', '[[\"Maker\",\"Checker\"]]'],
];
const insertRbacConfig = db.prepare(
  `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
   VALUES ('nbe', 'rbac', ?, ?, 1, datetime('now'))`
);
for (const [key, value] of rbacConfigDefaults) {
  insertRbacConfig.run(key, value);
}
console.log(`RBAC tenant_config seeded (${rbacConfigDefaults.length} keys).`);

// ---------------------------------------------------------------------------
// Migration 0039 — Regulator Reports: 7 seeded templates (idempotent)
// INSERT OR IGNORE ensures re-running seed.js is safe.
// Templates are scoped to tenant 'nbe' by default; the BoB tenant 'bhu'
// inherits RMA quarterly (its primary regulator).
// ---------------------------------------------------------------------------
const insertRegReport = db.prepare(`
  INSERT OR IGNORE INTO regulator_reports
    (tenant_id, regulator, name, parameters_schema_json, query_template, format, is_active, schedule_cron)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?)
`);

/**
 * 7 templates defined per §32 of UI_UX_REVIEW.md / Bhutan F#32.
 * parameters_schema_json follows JSON Schema draft-07 — ParamForm renders
 * dynamic inputs from this schema on the Report Detail page.
 * query_template is a SQL string stub; the Python router executes it against
 * the tenant DB with named params (e.g. :as_of_date, :branch).
 * schedule_cron: null = manual only; otherwise a standard 5-field cron expr.
 */
const REGULATOR_TEMPLATES = [
  {
    tenant_id: 'nbe',
    regulator: 'RMA',
    name: 'RMA Quarterly Compliance Report',
    parameters_schema_json: JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['as_of_date', 'quarter'],
      properties: {
        as_of_date: { type: 'string', format: 'date', description: 'Report as-of date (quarter end)' },
        quarter:    { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'], description: 'Fiscal quarter' },
        branch:     { type: 'string', description: 'Branch code (leave blank for all branches)' },
      },
    }),
    query_template: `SELECT doc_type, status, COUNT(*) AS count, branch
  FROM documents
  WHERE tenant_id = :tenant_id
    AND date(uploaded_at) <= date(:as_of_date)
  GROUP BY doc_type, status, branch
  ORDER BY doc_type, status`,
    format: 'pdf',
    schedule_cron: '0 6 1 1,4,7,10 *', // 06:00 on 1st of Jan/Apr/Jul/Oct
  },
  {
    tenant_id: 'nbe',
    regulator: 'CBE',
    name: 'CBE Quarterly KYC Compliance Report',
    parameters_schema_json: JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['as_of_date', 'quarter'],
      properties: {
        as_of_date: { type: 'string', format: 'date', description: 'Quarter end date' },
        quarter:    { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
        include_expired: { type: 'boolean', description: 'Include expired KYC documents', default: true },
      },
    }),
    query_template: `SELECT branch, doc_type, status, COUNT(*) AS count
  FROM documents
  WHERE tenant_id = :tenant_id
    AND doc_type IN ('passport','national_id','driving_license')
    AND date(uploaded_at) <= date(:as_of_date)
  GROUP BY branch, doc_type, status`,
    format: 'pdf',
    schedule_cron: '0 6 1 1,4,7,10 *',
  },
  {
    tenant_id: 'nbe',
    regulator: 'SAMA',
    name: 'SAMA Monthly Document Inventory',
    parameters_schema_json: JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['as_of_date'],
      properties: {
        as_of_date:  { type: 'string', format: 'date', description: 'Month-end date' },
        doc_type:    { type: 'string', description: 'Filter by document type (optional)' },
        risk_band:   { type: 'string', enum: ['low', 'medium', 'high', ''], description: 'Customer risk band filter' },
      },
    }),
    query_template: `SELECT doc_type, status, COUNT(*) AS count
  FROM documents
  WHERE tenant_id = :tenant_id
    AND date(uploaded_at) <= date(:as_of_date)
  GROUP BY doc_type, status`,
    format: 'csv',
    schedule_cron: '0 7 1 * *', // 07:00 on 1st of every month
  },
  {
    tenant_id: 'nbe',
    regulator: 'RBI',
    name: 'RBI Document Audit Trail',
    parameters_schema_json: JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['from_date', 'to_date'],
      properties: {
        from_date:   { type: 'string', format: 'date', description: 'Period start (inclusive)' },
        to_date:     { type: 'string', format: 'date', description: 'Period end (inclusive)' },
        doc_type:    { type: 'string', description: 'Restrict to a single document type' },
        customer_cid:{ type: 'string', description: 'Restrict to a single CID' },
      },
    }),
    query_template: `SELECT al.action, al.entity, al.created_at, al.user_id, d.doc_type, d.customer_cid
  FROM audit_log al
  LEFT JOIN documents d ON d.id = al.entity_id
  WHERE al.tenant_id = :tenant_id
    AND date(al.created_at) BETWEEN date(:from_date) AND date(:to_date)
  ORDER BY al.created_at DESC`,
    format: 'csv',
    schedule_cron: null,
  },
  {
    tenant_id: 'nbe',
    regulator: 'SOC2',
    name: 'SOC 2 Type II Evidence Pack',
    parameters_schema_json: JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['from_date', 'to_date'],
      properties: {
        from_date:   { type: 'string', format: 'date', description: 'Audit period start' },
        to_date:     { type: 'string', format: 'date', description: 'Audit period end' },
        control_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'SOC 2 control IDs to include (empty = all)',
          default: [],
        },
      },
    }),
    query_template: `SELECT al.id, al.action, al.entity_type, al.created_at, al.user_id, al.result
  FROM audit_log al
  WHERE al.tenant_id = :tenant_id
    AND date(al.created_at) BETWEEN date(:from_date) AND date(:to_date)
  ORDER BY al.created_at ASC`,
    format: 'pdf',
    schedule_cron: null,
  },
  {
    tenant_id: 'nbe',
    regulator: 'GDPR',
    name: 'GDPR Art-30 Record of Processing Activities (RoPA)',
    parameters_schema_json: JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['as_of_date'],
      properties: {
        as_of_date:        { type: 'string', format: 'date', description: 'As-of date for RoPA snapshot' },
        controller_name:   { type: 'string', description: 'Data controller legal name', default: 'National Bank of Egypt' },
        controller_email:  { type: 'string', format: 'email', description: 'DPO contact email' },
        include_transfers: { type: 'boolean', description: 'Include cross-border transfer entries', default: true },
      },
    }),
    query_template: `SELECT doc_type, COUNT(*) AS count, MIN(uploaded_at) AS earliest, MAX(uploaded_at) AS latest
  FROM documents
  WHERE tenant_id = :tenant_id AND date(uploaded_at) <= date(:as_of_date)
  GROUP BY doc_type`,
    format: 'jsonld',
    schedule_cron: null,
  },
  {
    tenant_id: 'nbe',
    regulator: 'PDPL',
    name: 'PDPL Data Breach Notification Report',
    parameters_schema_json: JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['breach_detected_at', 'breach_description'],
      properties: {
        breach_detected_at:  { type: 'string', format: 'date-time', description: 'Timestamp when breach was detected (ISO-8601)' },
        breach_description:  { type: 'string', minLength: 20, description: 'Brief description of the personal data incident' },
        affected_categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Categories of personal data affected',
          default: [],
        },
        estimated_subjects:  { type: 'integer', minimum: 0, description: 'Estimated number of data subjects affected' },
        containment_steps:   { type: 'string', description: 'Steps taken to contain the breach' },
        notified_authority:  { type: 'boolean', description: 'Has the supervisory authority been notified?', default: false },
      },
    }),
    query_template: `SELECT 'breach_notification' AS report_type, :breach_detected_at AS detected_at, COUNT(*) AS total_docs
  FROM documents WHERE tenant_id = :tenant_id`,
    format: 'jsonld',
    schedule_cron: null,
  },
];

// Also seed BoB tenant (bhu) with the RMA template — only if bhu tenant exists.
const bhuTenantRowExists = db.prepare("SELECT 1 FROM tenants WHERE tenant_id = 'bhu'").get();
const seedTemplates = bhuTenantRowExists
  ? [...REGULATOR_TEMPLATES, { ...REGULATOR_TEMPLATES[0], tenant_id: 'bhu' }]
  : REGULATOR_TEMPLATES;
for (const t of seedTemplates) {
  insertRegReport.run(
    t.tenant_id,
    t.regulator,
    t.name,
    t.parameters_schema_json,
    t.query_template,
    t.format,
    t.schedule_cron ?? null,
  );
}
console.log(`Regulator report templates seeded (${seedTemplates.length} total).`);

// ── regulator_reports namespace defaults for tenant_config ──────────────────
// These values populate the Admin Settings → Regulator Reports panel via
// the generic ConfigPanel (namespace = 'regulator_reports').
const regulatorReportsConfigDefaults = [
  ['seeded_regulators',          JSON.stringify(['RMA', 'CBE', 'SAMA', 'RBI', 'SOC2', 'GDPR', 'PDPL'])],
  ['signed_receipt_required',    'true'],
  ['auto_submit_enabled',        'false'],
  ['default_format',             'pdf'],
  ['pre_flight_checks_enabled',  'true'],
  ['retention_days_for_submissions', '2555'],  // 7 years
  ['webhook_token',              ''],           // filled by operator before enabling auto-submit
];
const insertRRConfig = db.prepare(
  `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
   VALUES ('nbe', 'regulator_reports', ?, ?, 1, datetime('now'))`
);
for (const [key, value] of regulatorReportsConfigDefaults) {
  insertRRConfig.run(key, value);
}
// Seed bhu with same defaults — only if the bhu tenant row exists.
const bhuTenantExists = db.prepare("SELECT 1 FROM tenants WHERE tenant_id = 'bhu'").get();
if (bhuTenantExists) {
  const insertRRConfigBhu = db.prepare(
    `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
     VALUES ('bhu', 'regulator_reports', ?, ?, 1, datetime('now'))`
  );
  for (const [key, value] of regulatorReportsConfigDefaults) {
    insertRRConfigBhu.run(key, value);
  }
}
console.log(`Regulator reports tenant_config seeded (${regulatorReportsConfigDefaults.length} keys).`);

// ---------------------------------------------------------------------------
// Migration 0042 — Notifications Wave C
// Add 4 columns to notifications table (idempotent ALTER TABLE guards).
// Add index for in-app feed queries.
// Seed notifications namespace tenant_config keys.
// ---------------------------------------------------------------------------

// 0042-a: column additions (SQLite requires separate ALTER TABLE per column).
const notifCols = db.prepare(`PRAGMA table_info(notifications)`).all().map((r) => r.name);
if (!notifCols.includes('is_read')) {
  db.exec("ALTER TABLE notifications ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0");
}
if (!notifCols.includes('read_at')) {
  db.exec("ALTER TABLE notifications ADD COLUMN read_at TEXT");
}
if (!notifCols.includes('event_type')) {
  db.exec("ALTER TABLE notifications ADD COLUMN event_type TEXT");
}
if (!notifCols.includes('template_id')) {
  db.exec("ALTER TABLE notifications ADD COLUMN template_id TEXT");
}
// Index is safe to re-run (IF NOT EXISTS).
db.exec("CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)");
console.log('[0042] notifications table columns + index ensured.');

// 0042-b: notifications namespace tenant_config defaults (idempotent INSERT OR IGNORE).
// Preserves the 5 existing SMTP keys seeded by Wave B Users v2.
// Event-type templates use {{var}} interpolation resolved in services/notify.js.
const notifConfigDefaults = [
  // ── Channel enabled toggles (default: email + in_app on; others off) ──
  ['channels.email.enabled',      'true'],
  ['channels.sms.enabled',        'false'],
  ['channels.whatsapp.enabled',   'false'],
  ['channels.in_app.enabled',     'true'],
  ['channels.push.enabled',       'false'],
  // ── Provider selection per channel ────────────────────────────────────
  ['email.provider',              '"local"'],
  ['sms.provider',                '"noop"'],
  // ── Throttle — email ─────────────────────────────────────────────────
  ['email.throttle.per_user_per_minute',   '5'],
  ['email.throttle.per_tenant_per_minute', '100'],
  ['email.throttle.burst',                 '10'],
  // ── Throttle — sms ───────────────────────────────────────────────────
  ['sms.throttle.per_user_per_minute',     '2'],
  ['sms.throttle.per_tenant_per_minute',   '50'],
  ['sms.throttle.burst',                   '5'],
  // ── Templates: expiry_alert ──────────────────────────────────────────
  ['templates.expiry_alert.subject',       '"[DMS] Document expiry alert"'],
  ['templates.expiry_alert.body',          '"Hello,\\n\\n{{count}} document(s) of type {{doc_type}} are expiring within {{band}} days. Please review and renew them promptly.\\n\\nDMS System"'],
  ['templates.expiry_alert.channels',      '["email","in_app"]'],
  ['templates.expiry_alert.locales',       '["en","dz"]'],
  // ── Templates: workflow_assigned ─────────────────────────────────────
  ['templates.workflow_assigned.subject',  '"[DMS] Workflow assigned to you"'],
  ['templates.workflow_assigned.body',     '"Hello,\\n\\nWorkflow {{ref_code}} ({{title}}) has been assigned to you for review. Please action it promptly.\\n\\nDMS System"'],
  ['templates.workflow_assigned.channels', '["email","in_app"]'],
  ['templates.workflow_assigned.locales',  '["en","dz"]'],
  // ── Templates: aml_hit ───────────────────────────────────────────────
  ['templates.aml_hit.subject',            '"[DMS] AML screening hit"'],
  ['templates.aml_hit.body',               '"Hello,\\n\\nAML screening for customer {{customer_cid}} returned {{hit_count}} hit(s). Please review in the AML module.\\n\\nDMS System"'],
  ['templates.aml_hit.channels',           '["email","in_app"]'],
  ['templates.aml_hit.locales',            '["en","dz"]'],
  // ── Templates: user_invite ───────────────────────────────────────────
  ['templates.user_invite.subject',        '"You have been invited to DocManager"'],
  ['templates.user_invite.body',           '"Hello,\\n\\n{{inviter_name}} has invited you to access DocManager as a {{role}}.\\n\\nClick the link below to set your password:\\n{{invite_link}}\\n\\nThis link expires in {{ttl_hours}} hours.\\n\\nDMS System"'],
  ['templates.user_invite.channels',       '["email"]'],
  ['templates.user_invite.locales',        '["en","dz"]'],
  // ── Templates: dsar_completed ────────────────────────────────────────
  ['templates.dsar_completed.subject',     '"[DMS] Your data request is ready"'],
  ['templates.dsar_completed.body',        '"Hello,\\n\\nYour DSAR request (ref: {{request_id}}) has been completed. Please log in to download your data package.\\n\\nDMS System"'],
  ['templates.dsar_completed.channels',    '["email","in_app"]'],
  ['templates.dsar_completed.locales',     '["en","dz"]'],
  // ── Routing: which roles receive each event type ──────────────────────
  ['routing.expiry_alert',        '["Doc Admin"]'],
  ['routing.workflow_assigned',   '["Maker","Checker"]'],
  ['routing.aml_hit',             '["Doc Admin","Checker"]'],
  ['routing.user_invite',         '[]'],
  ['routing.dsar_completed',      '[]'],
];

const insertNotifConfig = db.prepare(
  `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
   VALUES ('nbe', 'notifications', ?, ?, 1, datetime('now'))`
);
for (const [key, value] of notifConfigDefaults) {
  insertNotifConfig.run(key, value);
}
// Seed bhu tenant with same defaults — only if the bhu tenant row exists.
const bhuTenantExistsForNotif = db.prepare("SELECT 1 FROM tenants WHERE tenant_id = 'bhu'").get();
if (bhuTenantExistsForNotif) {
  const insertNotifConfigBhu = db.prepare(
    `INSERT OR IGNORE INTO tenant_config (tenant_id, namespace, key, value, schema_version, updated_at)
     VALUES ('bhu', 'notifications', ?, ?, 1, datetime('now'))`
  );
  for (const [key, value] of notifConfigDefaults) {
    insertNotifConfigBhu.run(key, value);
  }
}
console.log(`[0042] Notifications tenant_config seeded (${notifConfigDefaults.length} keys).`);

db.close();

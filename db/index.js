const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'nbe-dms.db'));
db.pragma('journal_mode = WAL');

/**
 * Defensive forward-only migrations. `CREATE TABLE IF NOT EXISTS` in
 * db/schema.sql is harmless but doesn't add new columns to existing rows,
 * so we additively apply them here at boot. Safe to re-run.
 */
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/**
 * Default capture-form field schemas. Only created when the
 * document_type_schemas table is empty — admins customise from there.
 * `ai_extract_from` names one of the 8 fields DocBrain already extracts:
 *   customer_cid | customer_name | doc_number | dob | issue_date |
 *   expiry_date | issuing_authority | address
 */
function seedDefaultTypeSchemas() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM document_type_schemas').get().c;
  if (count > 0) return;

  const insert = db.prepare(
    'INSERT INTO document_type_schemas (name, description, fields_json, active) VALUES (?, ?, ?, 1)',
  );

  const mk = (key, label, type, required = false, ai = null, extra = {}) => ({
    key,
    label,
    type,
    required,
    ...(ai ? { ai_extract_from: ai } : {}),
    ...extra,
  });

  const DEFAULTS = [
    {
      name: 'Passport',
      description: 'Travel document issued by a national passport authority.',
      fields: [
        mk('customer_name',      'Full name (as printed)', 'text',     true,  'customer_name'),
        mk('customer_cid',       'National CID',           'text',     true,  'customer_cid'),
        mk('doc_number',         'Passport number',        'text',     true,  'doc_number'),
        mk('dob',                'Date of birth',          'date',     false, 'dob'),
        mk('issue_date',         'Issue date',             'date',     false, 'issue_date'),
        mk('expiry_date',        'Expiry date',            'date',     true,  'expiry_date'),
        mk('issuing_authority',  'Issuing authority',      'text',     false, 'issuing_authority'),
        mk('nationality',        'Nationality',            'text',     false),
      ],
    },
    {
      name: 'National ID',
      description: 'Government-issued national identity card.',
      fields: [
        mk('customer_name',     'Full name',       'text',  true, 'customer_name'),
        mk('customer_cid',      'National CID',    'text',  true, 'customer_cid'),
        mk('doc_number',        'Card number',     'text',  true, 'doc_number'),
        mk('dob',               'Date of birth',   'date',  false, 'dob'),
        mk('issue_date',        'Issue date',      'date',  false, 'issue_date'),
        mk('expiry_date',       'Expiry date',     'date',  true,  'expiry_date'),
        mk('place_of_birth',    'Place of birth',  'text',  false),
        mk('gender',            'Gender',          'text',  false),
      ],
    },
    {
      name: 'Utility Bill',
      description: 'Proof-of-address document issued by a utility provider.',
      fields: [
        mk('customer_name',    'Account holder',     'text',     true,  'customer_name'),
        mk('account_number',   'Account number',     'text',     true),
        mk('service_address',  'Service address',    'textarea', true,  'address'),
        mk('billing_period',   'Billing period',     'text',     false),
        mk('amount_due',       'Amount due',         'text',     false),
        mk('issue_date',       'Statement date',     'date',     false, 'issue_date'),
        mk('provider',         'Utility provider',   'text',     false),
      ],
    },
    {
      name: 'Loan Application',
      description: 'Customer request for a credit product.',
      fields: [
        mk('customer_name',    'Applicant name',    'text',     true, 'customer_name'),
        mk('customer_cid',     'Applicant CID',     'text',     true, 'customer_cid'),
        mk('doc_number',       'Application ref',   'text',     true, 'doc_number'),
        mk('loan_amount',      'Loan amount',       'text',     true),
        mk('loan_term',        'Term (months)',     'number',   false),
        mk('purpose',          'Purpose',           'textarea', false),
        mk('submitted_date',   'Submitted date',    'date',     false, 'issue_date'),
      ],
    },
    {
      name: 'Contract',
      description: 'Signed agreement between two or more parties.',
      fields: [
        mk('counterparty',     'Counterparty',       'text',     true, 'customer_name'),
        mk('doc_number',       'Contract number',    'text',     true, 'doc_number'),
        mk('effective_date',   'Effective date',     'date',     true, 'issue_date'),
        mk('expiry_date',      'Expiry date',        'date',     false, 'expiry_date'),
        mk('contract_value',   'Contract value',     'text',     false),
        mk('jurisdiction',     'Jurisdiction',       'text',     false),
      ],
    },
    {
      name: 'Compliance',
      description: 'Regulatory attestation or compliance statement.',
      fields: [
        mk('customer_name',    'Subject',            'text', true, 'customer_name'),
        mk('customer_cid',     'Subject CID',        'text', false, 'customer_cid'),
        mk('doc_number',       'Ref number',         'text', false, 'doc_number'),
        mk('issue_date',       'Attested on',        'date', true,  'issue_date'),
        mk('expiry_date',      'Review by',          'date', false, 'expiry_date'),
        mk('regulator',        'Regulator',          'text', false, 'issuing_authority'),
      ],
    },
    {
      name: 'KYC',
      description: 'Know Your Customer onboarding packet.',
      fields: [
        mk('customer_name',    'Customer name',      'text',  true,  'customer_name'),
        mk('customer_cid',     'Customer CID',       'text',  true,  'customer_cid'),
        mk('doc_number',       'Document ID',        'text',  false, 'doc_number'),
        mk('dob',              'Date of birth',      'date',  false, 'dob'),
        mk('risk_band',        'Risk band',          'text',  false),
        mk('pep_flag',         'PEP flag',           'text',  false),
      ],
    },
    {
      name: 'Other',
      description: 'Fallback type for documents that don\'t match a known template.',
      fields: [
        mk('customer_name',   'Customer / subject',  'text',     false, 'customer_name'),
        mk('customer_cid',    'Customer CID',        'text',     false, 'customer_cid'),
        mk('doc_number',      'Reference number',    'text',     false, 'doc_number'),
        mk('issue_date',      'Issue date',          'date',     false, 'issue_date'),
        mk('expiry_date',     'Expiry date',         'date',     false, 'expiry_date'),
      ],
    },
  ];

  for (const d of DEFAULTS) {
    insert.run(d.name, d.description, JSON.stringify(d.fields));
  }
}

try {
  // Multi-tenancy scaffold — nullable, default 'nbe' for existing rows.
  addColumnIfMissing('documents',    'tenant_id', "tenant_id TEXT DEFAULT 'nbe'");
  addColumnIfMissing('workflows',    'tenant_id', "tenant_id TEXT DEFAULT 'nbe'");
  addColumnIfMissing('alerts',       'tenant_id', "tenant_id TEXT DEFAULT 'nbe'");
  addColumnIfMissing('audit_log',    'tenant_id', "tenant_id TEXT DEFAULT 'nbe'");
  addColumnIfMissing('users',        'tenant_id', "tenant_id TEXT DEFAULT 'nbe'");
  // Backfill any historical NULLs left by the ALTER (SQLite does not
  // retroactively populate the default for existing rows).
  db.exec(`UPDATE documents SET tenant_id = 'nbe' WHERE tenant_id IS NULL`);
  db.exec(`UPDATE workflows SET tenant_id = 'nbe' WHERE tenant_id IS NULL`);
  db.exec(`UPDATE alerts    SET tenant_id = 'nbe' WHERE tenant_id IS NULL`);
  db.exec(`UPDATE audit_log SET tenant_id = 'nbe' WHERE tenant_id IS NULL`);
  db.exec(`UPDATE users     SET tenant_id = 'nbe' WHERE tenant_id IS NULL`);
  // AI conversations — created even on an older seeded DB.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'New chat',
      scope_type TEXT NOT NULL DEFAULT 'all',
      scope_id INTEGER,
      tenant_id TEXT DEFAULT 'nbe',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_json TEXT,
      has_evidence INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id);
  `);

  // Dynamic per-type field schemas — admin-configurable.
  addColumnIfMissing('documents', 'metadata_json', 'metadata_json TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_type_schemas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      fields_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER DEFAULT 1,
      tenant_id TEXT DEFAULT 'nbe',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // AI-driven folder auto-routing: each doctype can nominate a default folder.
  addColumnIfMissing(
    'document_type_schemas',
    'default_folder_id',
    'default_folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL',
  );
  // OCR confidence tuning: per-doctype thresholds + last sample tested.
  addColumnIfMissing('document_type_schemas', 'autofill_floor',  'autofill_floor REAL DEFAULT 0.4');
  addColumnIfMissing('document_type_schemas', 'high_confidence', 'high_confidence REAL DEFAULT 0.7');
  addColumnIfMissing(
    'document_type_schemas',
    'tested_with_sample_id',
    'tested_with_sample_id INTEGER REFERENCES document_type_samples(id) ON DELETE SET NULL',
  );
  // AML screening: 4 tables for watchlist + screening + hit lifecycle.
  // The Node side proxies all reads to Python; these tables exist so future
  // Node-only compliance card queries can hit local SQLite without a Python
  // round trip. Mirrors python-service/app/models.py {AmlWatchlist, AmlWatchlistEntry,
  // AmlScreening, AmlHit} and Alembic revision 0021_aml_screening.
  db.exec(`
    CREATE TABLE IF NOT EXISTS aml_watchlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      list_name TEXT NOT NULL,
      source_url TEXT,
      match_threshold REAL NOT NULL DEFAULT 0.85,
      last_updated TEXT,
      entry_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, list_name)
    );
    CREATE INDEX IF NOT EXISTS idx_aml_watchlists_tenant ON aml_watchlists(tenant_id);

    CREATE TABLE IF NOT EXISTS aml_watchlist_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watchlist_id INTEGER NOT NULL REFERENCES aml_watchlists(id) ON DELETE CASCADE,
      normalized_name TEXT NOT NULL,
      dob TEXT,
      country TEXT,
      original_record TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_aml_entries_wl   ON aml_watchlist_entries(watchlist_id);
    CREATE INDEX IF NOT EXISTS idx_aml_entries_name ON aml_watchlist_entries(normalized_name);

    CREATE TABLE IF NOT EXISTS aml_screenings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      customer_cid TEXT NOT NULL,
      screened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'pending',
      hit_count INTEGER NOT NULL DEFAULT 0,
      trigger_reason TEXT,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aml_screenings_tenant ON aml_screenings(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_aml_screenings_cid    ON aml_screenings(tenant_id, customer_cid);
    CREATE INDEX IF NOT EXISTS idx_aml_screenings_at     ON aml_screenings(screened_at DESC);

    CREATE TABLE IF NOT EXISTS aml_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      screening_id INTEGER NOT NULL REFERENCES aml_screenings(id) ON DELETE CASCADE,
      watchlist_entry_id INTEGER NOT NULL REFERENCES aml_watchlist_entries(id) ON DELETE CASCADE,
      score REAL NOT NULL,
      decision TEXT NOT NULL DEFAULT 'open',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_aml_hits_screening ON aml_hits(screening_id);
    CREATE INDEX IF NOT EXISTS idx_aml_hits_decision  ON aml_hits(decision);
  `);

  // CBS integration tables — Temenos T24 linkage audit + circuit-breaker log.
  // Mirrors python-service/app/models.py {CbsDocumentLink, CbsCircuitEvent}
  // and Alembic revision 0022_cbs_document_links.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cbs_document_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      cif TEXT NOT NULL,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      transaction_ref TEXT NOT NULL,
      transaction_type TEXT,
      idempotency_key TEXT NOT NULL,
      linked_by INTEGER NOT NULL REFERENCES users(id),
      linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_cbs_links_tenant    ON cbs_document_links(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_cbs_links_doc       ON cbs_document_links(document_id);
    CREATE INDEX IF NOT EXISTS idx_cbs_links_cif       ON cbs_document_links(tenant_id, cif);
    CREATE INDEX IF NOT EXISTS idx_cbs_links_linked_at ON cbs_document_links(linked_at DESC);

    CREATE TABLE IF NOT EXISTS cbs_circuit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      adapter TEXT NOT NULL DEFAULT 'temenos',
      state_from TEXT NOT NULL,
      state_to TEXT NOT NULL,
      reason TEXT,
      consecutive_errors INTEGER NOT NULL DEFAULT 0,
      event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_cbs_circuit_tenant ON cbs_circuit_events(tenant_id, event_at DESC);
  `);

  seedDefaultTypeSchemas();
} catch (err) {
  // Never block boot on migration chatter; log for operators.
  // eslint-disable-next-line no-console
  console.error('[db] tenant_id migration skipped:', err.message);
}

module.exports = db;

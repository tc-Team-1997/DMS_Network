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
  // ── Wave A backend slices (worm / redaction / offline-sync / dzongkha) ──
  // Face-match has no Node-side tables — biometric encodings live Python-only.

  // WORM retention lock — chflags / chattr immutable enforcement (BHU-32).
  addColumnIfMissing('documents', 'worm_locked_at',     'worm_locked_at TEXT');
  addColumnIfMissing('documents', 'worm_unlock_after',  'worm_unlock_after TEXT');
  addColumnIfMissing('documents', 'worm_release_reason','worm_release_reason TEXT');
  addColumnIfMissing('documents', 'sha256_at_lock',     'sha256_at_lock TEXT');
  // Indexes are best-effort: try once, ignore if column came in a later migration.
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_documents_worm_locked_at    ON documents(worm_locked_at)"); } catch (e) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_documents_worm_unlock_after ON documents(worm_unlock_after)"); } catch (e) {}

  // Document redaction — version chain + audit log (BHU-46).
  addColumnIfMissing('documents', 'parent_id', 'parent_id INTEGER REFERENCES documents(id)');
  addColumnIfMissing('documents', 'redacted',  'redacted INTEGER DEFAULT 0');
  addColumnIfMissing('documents', 'version',   'version INTEGER DEFAULT 1');
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_documents_parent_id ON documents(parent_id)"); } catch (e) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_documents_redacted  ON documents(redacted)"); } catch (e) {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS redaction_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id         INTEGER NOT NULL REFERENCES documents(id),
      redacted_version_id INTEGER NOT NULL REFERENCES documents(id),
      redacted_by         TEXT NOT NULL,
      regions             TEXT NOT NULL,                  -- JSON array
      reason              TEXT NOT NULL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      tenant_id           TEXT NOT NULL DEFAULT 'nbe'
    );
    CREATE INDEX IF NOT EXISTS idx_rl_document_id ON redaction_log(document_id);
    CREATE INDEX IF NOT EXISTS idx_rl_version_id  ON redaction_log(redacted_version_id);
    CREATE INDEX IF NOT EXISTS idx_rl_created_at  ON redaction_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_rl_tenant_id   ON redaction_log(tenant_id);
  `);

  // Offline sync — idempotency keys for replayed uploads (BHU-57).
  // Composite PK (tenant_id, user_id, key) — see services/idempotency.js
  // for the v1.1 hardening note. The actual table bootstrap + v1-shape
  // migration live in services/idempotency.js so we don't duplicate
  // logic here. This block is left intentionally thin so that the
  // schema-ownership comment in db/index.js tells future readers
  // where to look.
  // (services/idempotency.js handles the create + composite-PK migration.)

  // Translations — Dzongkha / Arabic / English NLLB cache (BHU-14).
  db.exec(`
    CREATE TABLE IF NOT EXISTS translations (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id            TEXT NOT NULL,
      doc_id               INTEGER REFERENCES documents(id) ON DELETE SET NULL,
      source_lang          TEXT NOT NULL,
      target_lang          TEXT NOT NULL,
      sha256_source        TEXT NOT NULL,
      original_text_length INTEGER NOT NULL DEFAULT 0,
      translated_text      TEXT NOT NULL,
      confidence_estimate  REAL NOT NULL DEFAULT 0.0,
      model_version        TEXT NOT NULL DEFAULT 'facebook/nllb-200-distilled-600M',
      created_at           TEXT DEFAULT (datetime('now')),
      created_by           TEXT,
      deleted_at           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_translations_tenant_sha256 ON translations(tenant_id, sha256_source, source_lang, target_lang);
    CREATE INDEX IF NOT EXISTS idx_translations_doc_id        ON translations(doc_id);
    CREATE INDEX IF NOT EXISTS idx_translations_created_at    ON translations(created_at);
  `);

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

  // CC1 — Tenant registry + configuration store.
  // schema.sql already contains these CREATE TABLE IF NOT EXISTS blocks; the
  // exec below is the boot-time idempotency guard for existing DBs that
  // predate the schema.sql append (mirrors the pattern used above for
  // ai_conversations, redaction_log, cbs_document_links, etc.).
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id        TEXT PRIMARY KEY,
      slug             TEXT UNIQUE NOT NULL,
      display_name     TEXT NOT NULL,
      regulator_name   TEXT NOT NULL,
      regulator_short  TEXT NOT NULL,
      default_locale   TEXT NOT NULL DEFAULT 'en',
      allowed_locales  TEXT NOT NULL DEFAULT '["en"]',
      primary_color    TEXT NOT NULL DEFAULT '#0D2B6A',
      monogram         TEXT NOT NULL DEFAULT 'DM',
      logo_path        TEXT,
      favicon_path     TEXT,
      login_banner     TEXT,
      footer_text      TEXT,
      environment_label TEXT,
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tenant_config (
      tenant_id      TEXT NOT NULL,
      namespace      TEXT NOT NULL,
      key            TEXT NOT NULL,
      value          TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      updated_by     INTEGER,
      updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, namespace, key),
      FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_config_ns ON tenant_config(tenant_id, namespace);

    CREATE TABLE IF NOT EXISTS tenant_config_history (
      history_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      TEXT NOT NULL,
      namespace      TEXT NOT NULL,
      key            TEXT NOT NULL,
      value          TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      changed_by     INTEGER,
      reason         TEXT NOT NULL,
      changed_at     TEXT NOT NULL,
      prev_hash      TEXT,
      hash           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tcfg_hist
      ON tenant_config_history(tenant_id, namespace, key, changed_at DESC);
  `);
} catch (err) {
  // Never block boot on migration chatter; log for operators.
  // eslint-disable-next-line no-console
  console.error('[db] tenant_id migration skipped:', err.message);
}

module.exports = db;

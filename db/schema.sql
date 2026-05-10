CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  role TEXT DEFAULT 'Viewer',
  branch TEXT,
  mfa_enabled INTEGER DEFAULT 0,
  mfa_secret TEXT,
  status TEXT DEFAULT 'Active',
  api_key TEXT,
  tenant_id TEXT DEFAULT 'nbe',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reset_token TEXT,
  reset_token_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  channel     TEXT,
  subject     TEXT,
  body        TEXT,
  status      TEXT    DEFAULT 'sent',
  sent_at     TEXT    DEFAULT CURRENT_TIMESTAMP,
  -- Migration 0042 — in-app feed + event type tracking
  is_read     INTEGER NOT NULL DEFAULT 0,
  read_at     TEXT,
  event_type  TEXT,
  template_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER,
  changed_by INTEGER,
  change_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  user_id INTEGER,
  page INTEGER DEFAULT 1,
  kind TEXT,
  x REAL, y REAL, w REAL, h REAL,
  text TEXT,
  color TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  doc_type TEXT,
  steps_json TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Admin-configurable per-type field schemas for the Capture form.
-- fields_json is an array of { key, label, type, required, ai_extract_from? }.
-- Supported field types: text | textarea | date | number | email | tel | select
CREATE TABLE IF NOT EXISTS document_type_schemas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  fields_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER DEFAULT 1,
  tenant_id TEXT DEFAULT 'nbe',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  -- DocBrain inference columns (added in migration 0018)
  schema_version INTEGER NOT NULL DEFAULT 1,
  inference_status TEXT NOT NULL DEFAULT 'pending',   -- pending | running | done | failed
  source_samples_count INTEGER NOT NULL DEFAULT 0,
  vector_index_version INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- DocBrain document-type sample library (migration 0018)
-- Each row is one reference image/PDF that DocBrain uses to train/fine-tune
-- the inference pipeline for a given schema.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_type_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  label TEXT,
  notes TEXT,
  uploaded_by INTEGER,
  tenant_id TEXT NOT NULL DEFAULT 'nbe',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (schema_id) REFERENCES document_type_schemas(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  UNIQUE (schema_id, sha256)
);

CREATE INDEX IF NOT EXISTS idx_doctype_samples_schema  ON document_type_samples(schema_id);
CREATE INDEX IF NOT EXISTS idx_doctype_samples_sha256  ON document_type_samples(sha256);
CREATE INDEX IF NOT EXISTS idx_doctype_samples_tenant  ON document_type_samples(tenant_id);

CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER,
  user_id INTEGER,
  signer_name TEXT,
  signed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  certificate_hash TEXT,
  FOREIGN KEY (doc_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS retention_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT UNIQUE,
  retention_years INTEGER NOT NULL,
  auto_purge INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  FOREIGN KEY (parent_id) REFERENCES folders(id)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  original_name TEXT,
  doc_type TEXT,
  customer_cid TEXT,
  customer_name TEXT,
  doc_number TEXT,
  dob TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  issuing_authority TEXT,
  branch TEXT,
  folder_id INTEGER,
  status TEXT DEFAULT 'Valid',
  version TEXT DEFAULT 'v1.0',
  size INTEGER,
  mime_type TEXT,
  ocr_text TEXT,
  ocr_confidence REAL,
  uploaded_by INTEGER,
  tenant_id TEXT DEFAULT 'nbe',
  metadata_json TEXT,                 -- dynamic per-type fields, JSON object
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (folder_id) REFERENCES folders(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_code TEXT UNIQUE,
  title TEXT,
  doc_id INTEGER,
  stage TEXT DEFAULT 'Maker Review',
  priority TEXT DEFAULT 'Medium',
  tenant_id TEXT DEFAULT 'nbe',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doc_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT,
  title TEXT,
  meta TEXT,
  is_read INTEGER DEFAULT 0,
  tenant_id TEXT DEFAULT 'nbe',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  tenant_id TEXT DEFAULT 'nbe',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  policy_decision TEXT
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  scope_type TEXT NOT NULL DEFAULT 'all',       -- 'all' | 'document' | 'folder'
  scope_id   INTEGER,                           -- document_id or folder_id when scoped
  tenant_id  TEXT DEFAULT 'nbe',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,                           -- 'user' | 'assistant'
  content TEXT NOT NULL,
  citations_json TEXT,                          -- JSON array when assistant
  has_evidence INTEGER,                         -- 1 | 0 | NULL
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id);

-- ---------------------------------------------------------------------------
-- AI Engine glossary — business vocabulary the tool-using agent consults to
-- translate natural-language queries into column/table references and SQL
-- snippets. The first pass is auto-drafted by DocBrain against the schema;
-- Doc Admin users review, edit, and approve before it's considered trusted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_glossary_terms (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  term           TEXT NOT NULL,                 -- canonical user-facing name ("Processed documents")
  definition     TEXT NOT NULL,                 -- short human-readable explanation
  synonyms_json  TEXT NOT NULL DEFAULT '[]',    -- JSON array of aliases
  table_hint     TEXT,                          -- primary table the term maps to
  column_hint    TEXT,                          -- primary column, if applicable
  sql_template   TEXT,                          -- reusable SQL fragment (placeholder-friendly)
  category       TEXT NOT NULL DEFAULT 'metric',-- 'column' | 'metric' | 'filter' | 'entity'
  source         TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'admin'
  approved       INTEGER NOT NULL DEFAULT 0,    -- 1 once a Doc Admin signs off
  tenant_id      TEXT NOT NULL DEFAULT 'nbe',
  created_by     INTEGER,                       -- user id; null for auto-generated
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, term)
);

CREATE INDEX IF NOT EXISTS idx_ai_glossary_category ON ai_glossary_terms(category);
CREATE INDEX IF NOT EXISTS idx_ai_glossary_approved ON ai_glossary_terms(tenant_id, approved);

-- ---------------------------------------------------------------------------
-- BRD #20 — Saved Searches (Search v2 / migration 0030)
--
-- Migration strategy: SQLite cannot ALTER CHECK constraints.
-- On a fresh DB this CREATE TABLE runs directly.
-- On an existing DB with the old schema (scope CHECK 'private'|'public'),
-- db/seed.js runs the rename-recreate-copy-drop sequence below via a
-- conditional migration guard keyed on the sqlite_master definition.
-- FK check before authoring: grep found zero inbound references —
-- saved_searches is a leaf table; rename-copy-drop is safe.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_searches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL DEFAULT 'nbe',
  user_id     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  query_json  TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'private'
                CHECK (scope IN ('private', 'team', 'tenant')),
  branch      TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_run_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (user_id)   REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user         ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_tenant_scope ON saved_searches(tenant_id, scope);

-- ---------------------------------------------------------------------------
-- BRD #26 — Custom Dashboards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_dashboards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  name        TEXT NOT NULL DEFAULT 'My Dashboard',
  layout_json TEXT NOT NULL DEFAULT '[]',
  is_default  INTEGER NOT NULL DEFAULT 0,
  tenant_id   TEXT NOT NULL DEFAULT 'nbe',
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_user_dashboards_user ON user_dashboards(user_id);

-- ---------------------------------------------------------------------------
-- BRD #15 — Folder Permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS folder_perms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id  INTEGER NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('Doc Admin', 'Maker', 'Checker', 'Viewer')),
  can_view   INTEGER NOT NULL DEFAULT 0,
  can_edit   INTEGER NOT NULL DEFAULT 0,
  can_delete INTEGER NOT NULL DEFAULT 0,
  tenant_id  TEXT NOT NULL DEFAULT 'nbe',
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
  UNIQUE (folder_id, role, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_folder_perms_folder ON folder_perms(folder_id);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  original_name, customer_name, customer_cid, doc_number, ocr_text, notes
);

CREATE TRIGGER IF NOT EXISTS documents_fts_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, original_name, customer_name, customer_cid, doc_number, ocr_text, notes)
  VALUES (new.id, new.original_name, new.customer_name, new.customer_cid, new.doc_number, new.ocr_text, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_ad AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_au AFTER UPDATE ON documents BEGIN
  DELETE FROM documents_fts WHERE rowid = old.id;
  INSERT INTO documents_fts(rowid, original_name, customer_name, customer_cid, doc_number, ocr_text, notes)
  VALUES (new.id, new.original_name, new.customer_name, new.customer_cid, new.doc_number, new.ocr_text, new.notes);
END;

-- ---------------------------------------------------------------------------
-- Req 44-45 — Deduplication decision log
-- NOTE: dedup_settings table removed in migration 0036. Thresholds now live
-- in tenant_config namespace 'capture', keys 'dedup.fuzzy_min_ratio' and
-- 'dedup.phash_max_distance'. See services/duplicates.js for threshold logic.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Migration 0036 — Legal holds (Retention + WORM admin, F#30-31)
-- A legal hold pins a document so it is excluded from the retention sweep.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_holds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id      INTEGER NOT NULL,
  applied_by  TEXT    NOT NULL,
  applied_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by TEXT,
  released_at TEXT,
  reason      TEXT    NOT NULL,
  tenant_id   TEXT    NOT NULL DEFAULT 'nbe',
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_legal_holds_doc    ON legal_holds(doc_id);
CREATE INDEX IF NOT EXISTS idx_legal_holds_tenant ON legal_holds(tenant_id);

CREATE TABLE IF NOT EXISTS dedup_decisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL DEFAULT 'nbe',
  doc_id          INTEGER NOT NULL,
  matched_doc_id  INTEGER,
  score           REAL,
  decision        TEXT,     -- 'duplicate' | 'near' | 'unique'
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dedup_decisions_doc ON dedup_decisions(doc_id);

-- ---------------------------------------------------------------------------
-- CC1 — Tenant registry + configuration store
-- ---------------------------------------------------------------------------

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
  -- changed_at is set explicitly by the service layer (never server-default)
  -- so that the hash computed pre-INSERT matches what a verifier recomputes
  -- post-SELECT. Do not rely on DEFAULT CURRENT_TIMESTAMP here.
  changed_at     TEXT NOT NULL,
  prev_hash      TEXT,
  hash           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tcfg_hist ON tenant_config_history(tenant_id, namespace, key, changed_at DESC);

-- ---------------------------------------------------------------------------
-- Migration 0028 — Workflow action audit log (Workflows v2)
-- Separate from Python's workflow_steps (state-machine journal).
-- wf_actions records every approve/reject/escalate decision including the
-- SOX-required reason_code, freetext comment, optional step-up assertion id,
-- and optional attachment reference.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wf_actions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id           INTEGER NOT NULL,
  user_id               INTEGER NOT NULL,
  action                TEXT    NOT NULL,
  reason_code           TEXT,
  comment               TEXT,
  webauthn_assertion_id TEXT,
  attachment_id         INTEGER,
  tenant_id             TEXT    NOT NULL DEFAULT 'nbe',
  -- Migration 0032 (Wave C SOX-2): python_step_id links to Python workflow_steps.id.
  -- Written by Node after Python's /advance call succeeds (two-phase commit).
  -- NULL means the row was written by the pre-Wave-C path.
  python_step_id        INTEGER,
  created_at            TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id),
  FOREIGN KEY (user_id)     REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_wf_actions_workflow ON wf_actions(workflow_id);

-- ---------------------------------------------------------------------------
-- Migration 0029 — multi-page redactions
-- redactions: parent record per redaction event
-- redaction_pages: per-page bounding boxes so burn-in covers every page
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS redactions (
  redaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL,
  created_by   INTEGER,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason       TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (created_by)  REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_redactions_document ON redactions(document_id);

CREATE TABLE IF NOT EXISTS redaction_pages (
  redaction_id INTEGER NOT NULL,
  page         INTEGER NOT NULL,
  x            INTEGER NOT NULL,
  y            INTEGER NOT NULL,
  w            INTEGER NOT NULL,
  h            INTEGER NOT NULL,
  PRIMARY KEY (redaction_id, page),
  FOREIGN KEY (redaction_id) REFERENCES redactions(redaction_id)
);

CREATE INDEX IF NOT EXISTS idx_redaction_pages_rid ON redaction_pages(redaction_id);
CREATE INDEX IF NOT EXISTS idx_wf_actions_tenant   ON wf_actions(tenant_id);

-- ---------------------------------------------------------------------------
-- Migration 0031 — Users v2
-- user_invites: email magic-link invite tokens (SHA-256 of raw token stored)
-- saml_idps:    per-tenant IdP metadata + claim mapping for SAML SSO admin UI
-- NOTE: users.password column is nullable as of this migration (invite flow).
--       users.mfa_phone is added for SMS factor management.
-- The password nullability requires rename-recreate-copy-drop on existing DBs
-- (see db/seed.js migration 0031 block). Fresh DBs use this schema directly.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL,
  branch      TEXT,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tenant_id   TEXT NOT NULL DEFAULT 'nbe',
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_user_invites_token  ON user_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_invites_email  ON user_invites(email, tenant_id);

CREATE TABLE IF NOT EXISTS saml_idps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      TEXT NOT NULL,
  name           TEXT NOT NULL,
  metadata_xml   TEXT NOT NULL,
  claim_map_json TEXT NOT NULL DEFAULT '{}',
  enforce_only   INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_saml_idps_tenant ON saml_idps(tenant_id);

-- ---------------------------------------------------------------------------
-- Migration 0031 — Saved searches (Wave B)
-- (Placeholder row; the table is already present above for SQLite compat.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Migration 0032 — DocTypes v2 (DocTypes + Learn Wizard v2)
--
-- New tables:
--   doctype_versions    — version history for a document_type_schemas row
--   doctype_field_bbox  — per-field bounding box annotations on sample pages
--
-- New columns on document_type_schemas:
--   notify_days               — comma-separated notification bands, default "30,60,90"
--   translate_extracted_to_dz — Dzongkha translation toggle (0/1)
--
-- New column on workflows:
--   doctype_version_id — pins an instance to the live schema version at creation
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS doctype_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doctype_id  INTEGER NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  schema_json TEXT    NOT NULL DEFAULT '[]',
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status      TEXT    NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft', 'live', 'archived')),
  FOREIGN KEY (doctype_id) REFERENCES document_type_schemas(id) ON DELETE CASCADE,
  UNIQUE (doctype_id, version)
);

CREATE INDEX IF NOT EXISTS idx_doctype_versions_doctype ON doctype_versions(doctype_id);
CREATE INDEX IF NOT EXISTS idx_doctype_versions_status  ON doctype_versions(doctype_id, status);

CREATE TABLE IF NOT EXISTS doctype_field_bbox (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  doctype_version_id INTEGER NOT NULL,
  field_name         TEXT    NOT NULL,
  page               INTEGER NOT NULL DEFAULT 1,
  x                  REAL    NOT NULL,
  y                  REAL    NOT NULL,
  w                  REAL    NOT NULL,
  h                  REAL    NOT NULL,
  source             TEXT    NOT NULL DEFAULT 'confirmed'
                       CHECK(source IN ('confirmed', 'ai_proposed')),
  FOREIGN KEY (doctype_version_id) REFERENCES doctype_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dfbbox_version ON doctype_field_bbox(doctype_version_id);

-- Additive columns on document_type_schemas (safe to re-run — ALTER TABLE
-- is idempotent for new columns in SQLite when wrapped in the seed script).
-- The seed.js script guards these with a column-existence check.
-- (These are applied at boot time by the seed/migration logic.)

-- ALTER TABLE document_type_schemas ADD COLUMN notify_days TEXT DEFAULT '30,60,90';
-- ALTER TABLE document_type_schemas ADD COLUMN translate_extracted_to_dz INTEGER NOT NULL DEFAULT 0;

-- New column on workflows table
-- ALTER TABLE workflows ADD COLUMN doctype_version_id INTEGER REFERENCES doctype_versions(id);

-- ---------------------------------------------------------------------------
-- Migration 0033 — Template versioning + business calendars (Wave B)
--
-- New tables:
--   business_calendars     — tenant-scoped working-hour / holiday calendars
--   wf_template_versions   — immutable version snapshots of a workflow template
--                            carrying BPMN canvas JSON, DMN decision table JSON,
--                            per-stage SLA JSON, and a calendar reference.
--
-- New column on workflow_templates:
--   current_version_id — FK to the last published wf_template_versions row;
--                        allows quick "what is live?" lookup without a sub-query.
--
-- New column on workflows:
--   template_version_id — pins a running instance to the exact template version
--                         that was current when the workflow was created.
--                         NULL = legacy row; read stage list from
--                         workflow_templates.steps_json (legacy path).
--                         Non-NULL = read stage list from
--                         wf_template_versions.bpmn_json (new path).
--
-- Existing workflows retain NULL template_version_id and continue reading from
-- workflow_templates.steps_json without any data change.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_calendars (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id            TEXT    NOT NULL DEFAULT 'nbe',
  name                 TEXT    NOT NULL,
  holidays_json        TEXT    NOT NULL DEFAULT '[]',
  business_hours_json  TEXT    NOT NULL DEFAULT '{"days":[1,2,3,4,5],"start":"09:00","end":"17:00","tz":"Asia/Thimphu"}',
  created_by           INTEGER,
  created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_biz_cal_tenant ON business_calendars(tenant_id);

CREATE TABLE IF NOT EXISTS wf_template_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  version     INTEGER NOT NULL,
  bpmn_json   TEXT    NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  dmn_json    TEXT    NOT NULL DEFAULT '{}',
  sla_json    TEXT    NOT NULL DEFAULT '{}',
  calendar_id INTEGER,
  created_by  INTEGER,
  status      TEXT    NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft','published','archived')),
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES workflow_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (calendar_id) REFERENCES business_calendars(id),
  FOREIGN KEY (created_by)  REFERENCES users(id),
  UNIQUE (template_id, version)
);
CREATE INDEX IF NOT EXISTS idx_wftv_template ON wf_template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_wftv_status   ON wf_template_versions(status);

-- ---------------------------------------------------------------------------
-- Migration 0033 — Wave B placeholder (reserved)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Migration 0034 — Indexing Station: claim/lock table
--
-- indexing_locks: one row per document currently claimed for indexing.
--   doc_id    PRIMARY KEY  — at most one active claim per document.
--   user_id               — who holds the claim.
--   user_name             — denormalized for display without a JOIN.
--   claimed_at            — when the lock was acquired.
--   expires_at            — sweeper deletes rows past this timestamp.
--
-- Race-condition handling: the PK constraint makes concurrent INSERT-OR-FAIL
-- atomic in better-sqlite3 (synchronous, serialized writes). The claim
-- handler wraps sweep + insert + select in a single transaction.
--
-- TTL: runtime value read from tenant_config.indexing.claim_lock_ttl_minutes
--      (default 15). The schema.sql default is intentionally absent — TTL
--      is computed and interpolated by the route handler.
--
-- Sweeper: services/indexing-sweeper.js runs every 60 s and deletes rows
--          where expires_at < datetime('now').
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS indexing_locks (
  doc_id     INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  user_name  TEXT    NOT NULL,
  claimed_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT    NOT NULL,
  FOREIGN KEY (doc_id)  REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_indexing_locks_expires ON indexing_locks(expires_at);

-- ---------------------------------------------------------------------------
-- Migration 0035 — AML hit suppressions + Customer PII reveal audit
-- ---------------------------------------------------------------------------

-- aml_hit_suppressions: false-positive memory for AML hit-decide v2.
-- When a compliance officer suppresses a subject×watchlist-entry pair,
-- future screenings auto-clear the same pair until suppressed_until expires.
CREATE TABLE IF NOT EXISTS aml_hit_suppressions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          TEXT    NOT NULL,
  subject_cid        TEXT    NOT NULL,
  watchlist_entry_id INTEGER NOT NULL,
  suppression_reason TEXT    NOT NULL,
  suppressed_until   TEXT,                           -- ISO-8601 UTC; NULL = permanent
  suppressed_by      TEXT    NOT NULL,               -- username / principal sub
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aml_supp_tenant_cid
  ON aml_hit_suppressions(tenant_id, subject_cid);
CREATE INDEX IF NOT EXISTS idx_aml_supp_entry
  ON aml_hit_suppressions(watchlist_entry_id);
CREATE INDEX IF NOT EXISTS idx_aml_supp_cid_entry
  ON aml_hit_suppressions(tenant_id, subject_cid, watchlist_entry_id);

-- customer_pii_reveals: audit trail for every PII reveal in Customer-360.
-- Each row records one reveal event (user, CID, which fields, reason, timestamp).
CREATE TABLE IF NOT EXISTS customer_pii_reveals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    TEXT    NOT NULL,
  user_id      INTEGER NOT NULL,
  customer_cid TEXT    NOT NULL,
  fields_json  TEXT    NOT NULL,   -- JSON array e.g. '["phone","email"]'
  reason       TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pii_reveals_tenant_cid
  ON customer_pii_reveals(tenant_id, customer_cid);
CREATE INDEX IF NOT EXISTS idx_pii_reveals_user
  ON customer_pii_reveals(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_pii_reveals_created
  ON customer_pii_reveals(created_at);

-- ---------------------------------------------------------------------------
-- Migration 0038 — Audit log v2 (Wave C)
--
-- 1. Five new columns on audit_log:
--      entity_type  — document | customer | workflow | user | config | system
--      detail       — JSON object with before/after/context (replaces freetext details)
--      prev_hash    — SHA-256 of the preceding row's hash (NULL for id=1)
--      hash         — SHA-256( (prev_hash||'') + canonical_json(row) )
--      result       — allow | deny | error
--
-- 2. FTS5 virtual table audit_log_fts over (detail, action, entity_type) with
--    content-table mapping so DELETE/UPDATE rebuild the index correctly.
--
-- 3. AFTER INSERT / UPDATE / DELETE triggers keep the FTS index in sync.
--
-- Existing rows are backfilled with the hash chain at boot time by
-- db/index.js (see migration 0038 guard). Chain is unbroken from id=1 forward.
-- ---------------------------------------------------------------------------

-- New columns (idempotent when run via db/index.js addColumnIfMissing):
-- These are applied programmatically in db/index.js so that the ALTER TABLE
-- succeeds on both a fresh DB and an existing populated DB.

-- FTS5 virtual table. Uses content='audit_log', content_rowid='id' so
-- fts5 can perform DELETE operations correctly without storing a copy.
CREATE VIRTUAL TABLE IF NOT EXISTS audit_log_fts
  USING fts5(
    detail,
    action,
    entity_type,
    content='audit_log',
    content_rowid='id',
    tokenize='unicode61'
  );

-- AFTER INSERT: add new row to FTS index.
CREATE TRIGGER IF NOT EXISTS audit_log_fts_ai
  AFTER INSERT ON audit_log
BEGIN
  INSERT INTO audit_log_fts(rowid, detail, action, entity_type)
    VALUES (new.id, new.detail, new.action, new.entity_type);
END;

-- AFTER UPDATE: delete old FTS entry, insert new.
CREATE TRIGGER IF NOT EXISTS audit_log_fts_au
  AFTER UPDATE ON audit_log
BEGIN
  INSERT INTO audit_log_fts(audit_log_fts, rowid, detail, action, entity_type)
    VALUES ('delete', old.id, old.detail, old.action, old.entity_type);
  INSERT INTO audit_log_fts(rowid, detail, action, entity_type)
    VALUES (new.id, new.detail, new.action, new.entity_type);
END;

-- AFTER DELETE: remove from FTS index.
CREATE TRIGGER IF NOT EXISTS audit_log_fts_ad
  AFTER DELETE ON audit_log
BEGIN
  INSERT INTO audit_log_fts(audit_log_fts, rowid, detail, action, entity_type)
    VALUES ('delete', old.id, old.detail, old.action, old.entity_type);
END;

-- ---------------------------------------------------------------------------
-- Migration 0039 — Regulator Reports (Wave C)
--
-- regulator_reports: template registry for each supported regulatory body.
--   Each template encodes the format (pdf|csv|jsonld), a JSON Schema for its
--   required parameters, and an optional cron schedule for recurring generation.
--
-- submission_receipts: immutable audit log of every generated report with a
--   SHA-256 content hash + RSA-PSS detached signature manifest for
--   non-repudiation. Live submission to regulator portals is stubbed in v1 —
--   the row records the would-be endpoint URL and captures the response once
--   the operator manually triggers the submit action.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS regulator_reports (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id              TEXT    NOT NULL DEFAULT 'default',
  regulator              TEXT    NOT NULL,
  name                   TEXT    NOT NULL,
  -- JSON Schema string for the parameters the template accepts.
  parameters_schema_json TEXT    NOT NULL DEFAULT '{}',
  -- SQL query template; may use :as_of_date plus schema-defined named params.
  query_template         TEXT    NOT NULL DEFAULT '',
  -- Path to a Jinja2/plain-text output template (relative to STORAGE_DIR).
  output_template_path   TEXT,
  -- pdf | csv | jsonld   (XLSX absent: SheetJS not in package.json → CSV used)
  format                 TEXT    NOT NULL DEFAULT 'pdf',
  is_active              INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Cron expression for scheduled generation, e.g. '0 6 1 * *' (1st of month).
  schedule_cron          TEXT
);

CREATE INDEX IF NOT EXISTS idx_rr_tenant_regulator
  ON regulator_reports(tenant_id, regulator);

CREATE INDEX IF NOT EXISTS idx_rr_active
  ON regulator_reports(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS submission_receipts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id            TEXT    NOT NULL DEFAULT 'default',
  report_template_id   INTEGER NOT NULL REFERENCES regulator_reports(id) ON DELETE CASCADE,
  generated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  generated_by         TEXT,          -- username / principal
  -- JSON snapshot of the params used at generation time.
  params_json          TEXT    NOT NULL DEFAULT '{}',
  file_path            TEXT,          -- path under STORAGE_DIR to the generated file
  sha256               TEXT,          -- hex SHA-256 of the generated file bytes
  -- JSON manifest from services/signing.py::sign_detached
  -- fields: sha256, signed_at, signer, cert_fingerprint_sha256, algorithm
  signature            TEXT,
  submitted_at         TEXT,          -- ISO-8601 UTC when submit-to-regulator was called
  regulator_endpoint   TEXT,          -- URL that would be POSTed in live submission
  response_code        INTEGER,       -- HTTP status returned (stubbed: 202)
  response_body        TEXT           -- raw response body (stubbed)
);

CREATE INDEX IF NOT EXISTS idx_sr_tenant_template
  ON submission_receipts(tenant_id, report_template_id);

CREATE INDEX IF NOT EXISTS idx_sr_generated_at
  ON submission_receipts(generated_at);

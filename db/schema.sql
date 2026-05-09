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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  channel TEXT,
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'sent',
  sent_at TEXT DEFAULT CURRENT_TIMESTAMP
);

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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
-- Req 44-45 — Deduplication settings and decision log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dedup_settings (
  tenant_id        TEXT PRIMARY KEY,
  fuzzy_threshold  REAL    DEFAULT 0.8,
  phash_distance   INTEGER DEFAULT 10,
  updated_at       TEXT    DEFAULT CURRENT_TIMESTAMP,
  updated_by       INTEGER
);

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

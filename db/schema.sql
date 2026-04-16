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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

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

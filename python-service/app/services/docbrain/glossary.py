"""AI Engine glossary — editable business vocabulary the tool-using agent
consults before composing analytics queries.

Design notes:
  - Glossary rows live in the Node SQLite (the same DB as documents /
    workflows / alerts) so the admin CRUD surface is session-authenticated
    and tenant-scoped via the existing SPA stack.
  - This module owns three concerns:
        1. CRUD helpers (list/get/create/update/delete/approve)
        2. Schema-introspection bootstrap — first-run / "regenerate" job
           that asks the LLM to draft glossary entries for each column of
           the key DMS tables plus a short list of business metrics.
        3. Vector indexing — glossary terms are embedded and stored in the
           docbrain vector store under a reserved pseudo-document-id so the
           agent's `lookup_glossary` tool can semantic-search them.
  - Admin edits (`approved = 1, source = 'admin'`) are authoritative; the
    auto-regenerate job never overwrites an admin-edited row.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .embed import embed_text
from .llm import chat_json
from .vectors import _DB_PATH as VECTOR_DB_PATH  # reuse the docbrain sqlite-vec store

log = logging.getLogger(__name__)

# Reserved negative rowids for glossary chunks in docbrain_chunks; keeps
# them trivially separable from real document chunks without a schema change.
GLOSSARY_DOC_ID = -1

CATEGORIES = {"column", "metric", "filter", "entity"}

# Tables the auto-bootstrap job inspects. Explicit allow-list so we don't
# leak internal/FTS shadow tables into the glossary. The AI meta tables
# (ai_conversations / ai_messages / ai_glossary_terms) are intentionally
# excluded — exposing them to the agent would let a user query the audit
# of their own chat transcripts, which is a privacy surprise.
BOOTSTRAP_TABLES = (
    "documents",
    "workflows",
    "workflow_templates",
    "alerts",
    "folders",
    "document_versions",
    "document_type_schemas",
    "retention_policies",
    "audit_log",
    "annotations",
    "signatures",
    "notifications",
    "users",
)


# ---------- data shapes ---------------------------------------------------

@dataclass
class GlossaryTerm:
    id: int
    term: str
    definition: str
    synonyms: List[str]
    table_hint: Optional[str]
    column_hint: Optional[str]
    sql_template: Optional[str]
    category: str
    source: str
    approved: bool
    tenant_id: str
    created_by: Optional[int]
    created_at: str
    updated_at: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "term": self.term,
            "definition": self.definition,
            "synonyms": self.synonyms,
            "table_hint": self.table_hint,
            "column_hint": self.column_hint,
            "sql_template": self.sql_template,
            "category": self.category,
            "source": self.source,
            "approved": self.approved,
            "tenant_id": self.tenant_id,
            "created_by": self.created_by,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


# ---------- Node DB access -------------------------------------------------

def _node_db_path() -> str:
    env = os.environ.get("NODE_DB_PATH")
    if env:
        return env
    return str((Path(__file__).resolve().parents[4] / "db" / "nbe-dms.db"))


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_node_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _hydrate(row: sqlite3.Row) -> GlossaryTerm:
    try:
        synonyms = json.loads(row["synonyms_json"] or "[]")
    except (TypeError, ValueError):
        synonyms = []
    return GlossaryTerm(
        id=int(row["id"]),
        term=row["term"],
        definition=row["definition"],
        synonyms=synonyms if isinstance(synonyms, list) else [],
        table_hint=row["table_hint"],
        column_hint=row["column_hint"],
        sql_template=row["sql_template"],
        category=row["category"],
        source=row["source"],
        approved=bool(row["approved"]),
        tenant_id=row["tenant_id"],
        created_by=row["created_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ---------- CRUD ----------------------------------------------------------

def list_terms(
    *,
    tenant_id: str = "nbe",
    category: Optional[str] = None,
    approved: Optional[bool] = None,
    query: Optional[str] = None,
    limit: int = 500,
) -> List[GlossaryTerm]:
    sql = "SELECT * FROM ai_glossary_terms WHERE tenant_id = ?"
    params: List[Any] = [tenant_id]
    if category:
        sql += " AND category = ?"
        params.append(category)
    if approved is not None:
        sql += " AND approved = ?"
        params.append(1 if approved else 0)
    if query:
        sql += " AND (term LIKE ? OR definition LIKE ? OR synonyms_json LIKE ?)"
        like = f"%{query}%"
        params += [like, like, like]
    sql += " ORDER BY category, term LIMIT ?"
    params.append(int(limit))
    conn = _conn()
    try:
        rows = conn.execute(sql, params).fetchall()
        return [_hydrate(r) for r in rows]
    finally:
        conn.close()


def get_term(term_id: int, *, tenant_id: str = "nbe") -> Optional[GlossaryTerm]:
    conn = _conn()
    try:
        row = conn.execute(
            "SELECT * FROM ai_glossary_terms WHERE id = ? AND tenant_id = ?",
            (term_id, tenant_id),
        ).fetchone()
        return _hydrate(row) if row else None
    finally:
        conn.close()


def create_term(
    *,
    term: str,
    definition: str,
    tenant_id: str = "nbe",
    synonyms: Optional[List[str]] = None,
    table_hint: Optional[str] = None,
    column_hint: Optional[str] = None,
    sql_template: Optional[str] = None,
    category: str = "metric",
    source: str = "admin",
    approved: bool = True,
    created_by: Optional[int] = None,
) -> GlossaryTerm:
    if category not in CATEGORIES:
        raise ValueError(f"invalid category: {category}")
    conn = _conn()
    try:
        cur = conn.execute(
            """INSERT INTO ai_glossary_terms
                (term, definition, synonyms_json, table_hint, column_hint,
                 sql_template, category, source, approved, tenant_id, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (term.strip(), definition.strip(), json.dumps(synonyms or []),
             table_hint, column_hint, sql_template, category, source,
             1 if approved else 0, tenant_id, created_by),
        )
        conn.commit()
        term_id = int(cur.lastrowid)
        row = conn.execute(
            "SELECT * FROM ai_glossary_terms WHERE id = ?", (term_id,),
        ).fetchone()
        hydrated = _hydrate(row)
    finally:
        conn.close()
    _index_term(hydrated)
    return hydrated


def update_term(
    term_id: int,
    *,
    tenant_id: str = "nbe",
    fields: Optional[Dict[str, Any]] = None,
) -> Optional[GlossaryTerm]:
    """Partial update. A *semantic* change (definition, synonyms, SQL template,
    etc.) flips `source = 'admin'` so the bootstrap job knows to preserve it.
    A pure approval toggle does NOT flip the source — approving auto-drafts
    should leave them free to be regenerated on a later schema change."""
    fields = fields or {}
    allowed = {
        "term", "definition", "synonyms", "table_hint", "column_hint",
        "sql_template", "category", "approved",
    }
    # Approval is a governance flag, not an edit — changing only `approved`
    # keeps the row's source unchanged.
    semantic_fields = allowed - {"approved"}
    sets: List[str] = []
    params: List[Any] = []
    touched_semantic = False
    for key, val in fields.items():
        if key not in allowed:
            continue
        if key in semantic_fields:
            touched_semantic = True
        if key == "synonyms":
            sets.append("synonyms_json = ?")
            params.append(json.dumps(val if isinstance(val, list) else []))
        elif key == "approved":
            sets.append("approved = ?")
            params.append(1 if val else 0)
        elif key == "category":
            if val not in CATEGORIES:
                raise ValueError(f"invalid category: {val}")
            sets.append("category = ?")
            params.append(val)
        else:
            sets.append(f"{key} = ?")
            params.append(val)
    if not sets:
        return get_term(term_id, tenant_id=tenant_id)
    if touched_semantic:
        sets.append("source = 'admin'")
    sets.append("updated_at = CURRENT_TIMESTAMP")
    params.extend([term_id, tenant_id])
    conn = _conn()
    try:
        conn.execute(
            f"UPDATE ai_glossary_terms SET {', '.join(sets)} WHERE id = ? AND tenant_id = ?",
            params,
        )
        conn.commit()
    finally:
        conn.close()
    updated = get_term(term_id, tenant_id=tenant_id)
    if updated:
        _index_term(updated)
    return updated


def delete_term(term_id: int, *, tenant_id: str = "nbe") -> bool:
    conn = _conn()
    try:
        cur = conn.execute(
            "DELETE FROM ai_glossary_terms WHERE id = ? AND tenant_id = ?",
            (term_id, tenant_id),
        )
        conn.commit()
        deleted = cur.rowcount > 0
    finally:
        conn.close()
    if deleted:
        _drop_term_chunk(term_id)
    return deleted


# ---------- schema introspection + LLM bootstrap ---------------------------

def introspect_schema() -> Dict[str, List[Dict[str, Any]]]:
    """Read the pragma for each BOOTSTRAP_TABLES and return a JSON-friendly
    column spec the LLM can reason over without having to parse SQL."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    conn = _conn()
    try:
        for tbl in BOOTSTRAP_TABLES:
            cols = conn.execute(f"PRAGMA table_info({tbl})").fetchall()
            out[tbl] = [
                {"name": c["name"], "type": c["type"], "notnull": bool(c["notnull"])}
                for c in cols
            ]
    finally:
        conn.close()
    return out


_METRIC_PROMPT = """You draft BUSINESS METRIC entries for a bank's Document
Management System glossary. Each metric is a named, reusable filter a
compliance officer might ask — pending documents, processed documents,
expiring soon, recently uploaded, open workflows, critical alerts, etc.

Given the table schema, produce 6–12 metric entries. Each must include a
valid SQLite WHERE-clause fragment (no trailing semicolon, no WHERE
keyword, just the predicate) that uses columns from the schema.

Output strictly as JSON:
{"terms": [ {term, definition, synonyms, table_hint, sql_template}, ... ]}
Keep definitions short and plain-English. `synonyms` must be a string array.
"""


# Per-column heuristics for the deterministic pass. Keep these short —
# admin can edit any of them, and the updates flow into future regenerates.
_COLUMN_HINTS: Dict[str, str] = {
    "id":                "Primary key identifier.",
    "created_at":        "Timestamp when the row was inserted.",
    "updated_at":        "Timestamp of the last update to the row.",
    "uploaded_at":       "When the file was uploaded to the DMS.",
    "tenant_id":         "Tenant scope — isolates multi-tenant data.",
    "status":            "Current lifecycle state of the row.",
    "priority":          "Priority band such as High / Medium / Low.",
    "stage":             "Current workflow stage (e.g. Maker Review, Approved).",
    "doc_type":          "Business classification of the document.",
    "branch":            "Bank branch that owns the record.",
    "customer_cid":      "National customer identifier linked to the document.",
    "customer_name":     "Customer's full name as extracted from the document.",
    "doc_number":        "Document-specific reference such as passport or ID number.",
    "dob":               "Date of birth captured from the document.",
    "issue_date":        "When the source document was issued.",
    "expiry_date":       "When the source document ceases to be valid.",
    "issuing_authority": "Government body or issuer that produced the document.",
    "mime_type":         "MIME type of the uploaded file.",
    "size":              "File size in bytes.",
    "version":           "Semantic version tag applied at upload time.",
    "ocr_text":          "Plain-text content extracted by OCR.",
    "ocr_confidence":    "Mean OCR confidence percentage (0–100).",
    "role":              "RBAC role (Doc Admin / Maker / Checker / Viewer).",
    "level":             "Severity level of an alert (critical / warning / info / success).",
    "is_read":           "Read flag — 1 once the recipient has acknowledged it.",
    "folder_id":         "Parent folder id in the virtual filing tree.",
    "parent_id":         "Parent record id used by hierarchical tables.",
    "user_id":           "Owning user id for per-user rows.",
    "document_id":       "Related document id.",
    "doc_id":            "Related document id.",
    "action":            "Audit log action code (login, upload, approve, etc.).",
    "entity_type":       "Type of record the audit log entry refers to.",
    "entity_id":         "Id of the record the audit log entry refers to.",
    "retention_years":   "Number of years the document type must be retained.",
    "auto_purge":        "Flag — 1 if rows past retention are automatically deleted.",
}


def _definition_for_column(table: str, column: str, col_type: str) -> str:
    if column in _COLUMN_HINTS:
        return _COLUMN_HINTS[column]
    # Fall back to a generic description built from the column name.
    nice = column.replace("_", " ").strip()
    return f"{nice.capitalize()} field on the {table} table ({col_type or 'TEXT'})."


# Short entity-level descriptions — one per table. Gives the agent an
# anchor to resolve questions like "what are retention policies?" or "show
# me audit log entries" without hallucinating a table name.
_TABLE_ENTITY: Dict[str, Dict[str, Any]] = {
    "documents": {
        "term": "Documents",
        "definition": "Main ledger of every file captured in the DMS. One row per uploaded document with its classification, customer metadata, branch, status, and lifecycle timestamps.",
        "synonyms": ["files", "records", "papers"],
    },
    "document_versions": {
        "term": "Document versions",
        "definition": "Version history for each document. Lets auditors trace which body was approved when a document is superseded.",
        "synonyms": ["versions", "revisions", "history"],
    },
    "document_type_schemas": {
        "term": "Document type schemas",
        "definition": "Dynamic per-doc_type metadata schemas that drive the Capture form fields and validation rules.",
        "synonyms": ["schemas", "metadata templates"],
    },
    "folders": {
        "term": "Folders",
        "definition": "Virtual filing tree that groups documents by business context (KYC, Loans, Contracts, Compliance, Archived).",
        "synonyms": ["filing tree", "directories"],
    },
    "workflows": {
        "term": "Workflows",
        "definition": "Live workflow instances moving through Maker Review → Checker → Approve → Archive. Each row tracks stage, priority, and the document it refers to.",
        "synonyms": ["reviews", "approvals", "tasks"],
    },
    "workflow_templates": {
        "term": "Workflow templates",
        "definition": "Canonical step lists per doc_type (e.g. 'KYC Standard', 'Loan Fast-track') used to spawn new workflow instances.",
        "synonyms": ["workflow blueprints", "templates"],
    },
    "alerts": {
        "term": "Alerts",
        "definition": "System-wide banner notifications — critical (compliance breach), warning (expiring soon), info (batch complete), success (workflow approved).",
        "synonyms": ["notifications", "warnings"],
    },
    "notifications": {
        "term": "Notifications",
        "definition": "Per-user messages that drive the bell icon. Distinct from Alerts which are system-wide banners.",
        "synonyms": ["user messages", "inbox"],
    },
    "retention_policies": {
        "term": "Retention policies",
        "definition": "Per-doc_type retention rules. Each policy pairs a doc_type with retention_years and an auto_purge flag that controls whether documents past the window are deleted automatically or surfaced for manual review.",
        "synonyms": ["retention rules", "data retention", "purge policies"],
    },
    "audit_log": {
        "term": "Audit log",
        "definition": "Immutable trail of meaningful user and system actions (login, upload, approve, reject, delete). Each row carries user_id, action, entity_type, entity_id, and a timestamp.",
        "synonyms": ["audit trail", "action log", "history"],
    },
    "annotations": {
        "term": "Annotations",
        "definition": "Per-document notes, highlights, and comments left by reviewers. Attached to a specific document and page.",
        "synonyms": ["comments", "notes", "markups"],
    },
    "signatures": {
        "term": "Signatures",
        "definition": "E-signature state for documents that require one. Each row binds a document to a user and tracks the signature status.",
        "synonyms": ["e-signatures", "signoffs"],
    },
    "users": {
        "term": "Users",
        "definition": "DMS user accounts with RBAC role (Doc Admin / Maker / Checker / Viewer / Auditor), home branch, and status (Active / Locked).",
        "synonyms": ["accounts", "staff"],
    },
}


def _synonyms_for_column(column: str) -> List[str]:
    aliases: Dict[str, List[str]] = {
        "uploaded_at":    ["uploaded", "upload date", "ingested"],
        "created_at":     ["created", "inserted"],
        "updated_at":     ["updated", "last modified"],
        "expiry_date":    ["expires", "valid until"],
        "customer_cid":   ["cid", "national id", "customer id"],
        "doc_type":       ["document type", "category", "kind"],
        "status":         ["state", "lifecycle"],
        "role":           ["user role", "rbac role"],
        "branch":         ["office", "location"],
    }
    return aliases.get(column, [])


def _bootstrap_columns_deterministic(
    *,
    tenant_id: str,
    admin_terms: set,
    overwrite_auto: bool,
) -> Dict[str, int]:
    """Walk every table/column in BOOTSTRAP_TABLES and upsert a glossary row
    per column. Purely deterministic — no LLM call — so coverage is complete
    even on small models. Admin-edited rows are preserved."""
    spec = introspect_schema()
    inserted = updated = skipped_admin = 0
    conn = _conn()
    try:
        # Phase A1 — one `entity` row per table. Gives the agent a top-level
        # anchor so "retention policies" resolves to retention_policies
        # without the model having to guess.
        for table in spec.keys():
            entity = _TABLE_ENTITY.get(table)
            if not entity:
                continue
            term = entity["term"]
            if term.lower() in admin_terms:
                skipped_admin += 1
                continue
            try:
                cur = conn.execute(
                    """INSERT INTO ai_glossary_terms
                         (term, definition, synonyms_json, table_hint,
                          column_hint, sql_template, category, source,
                          approved, tenant_id)
                       VALUES (?, ?, ?, ?, NULL, NULL, 'entity', 'auto', 0, ?)
                       ON CONFLICT(tenant_id, term) DO UPDATE SET
                         definition   = excluded.definition,
                         synonyms_json= excluded.synonyms_json,
                         table_hint   = excluded.table_hint,
                         category     = 'entity',
                         source       = 'auto',
                         updated_at   = CURRENT_TIMESTAMP
                       WHERE ai_glossary_terms.source != 'admin'""",
                    (term, entity["definition"],
                     json.dumps(entity.get("synonyms", [])),
                     table, tenant_id),
                )
                if cur.rowcount and cur.lastrowid and overwrite_auto:
                    inserted += 1
                elif cur.rowcount:
                    updated += 1
            except sqlite3.Error as exc:
                log.warning("entity glossary insert failed %s: %s", table, exc)

        # Phase A2 — one `column` row per column across all tables.
        for table, cols in spec.items():
            for c in cols:
                column = c["name"]
                col_type = c.get("type", "")
                term = f"{table}.{column}"
                if term.lower() in admin_terms:
                    skipped_admin += 1
                    continue
                definition = _definition_for_column(table, column, col_type)
                synonyms = _synonyms_for_column(column)
                try:
                    cur = conn.execute(
                        """INSERT INTO ai_glossary_terms
                             (term, definition, synonyms_json, table_hint,
                              column_hint, sql_template, category, source,
                              approved, tenant_id)
                           VALUES (?, ?, ?, ?, ?, NULL, 'column', 'auto', 0, ?)
                           ON CONFLICT(tenant_id, term) DO UPDATE SET
                             definition   = excluded.definition,
                             synonyms_json= excluded.synonyms_json,
                             table_hint   = excluded.table_hint,
                             column_hint  = excluded.column_hint,
                             category     = 'column',
                             source       = 'auto',
                             updated_at   = CURRENT_TIMESTAMP
                           WHERE ai_glossary_terms.source != 'admin'""",
                        (term, definition, json.dumps(synonyms),
                         table, column, tenant_id),
                    )
                    if cur.rowcount and cur.lastrowid and overwrite_auto:
                        inserted += 1
                    elif cur.rowcount:
                        updated += 1
                except sqlite3.Error as exc:
                    log.warning("column glossary insert failed %s.%s: %s", table, column, exc)
        conn.commit()
    finally:
        conn.close()
    return {"inserted": inserted, "updated": updated, "skipped_admin": skipped_admin}


def bootstrap_from_llm(
    *,
    tenant_id: str = "nbe",
    overwrite_auto: bool = True,
) -> Dict[str, Any]:
    """Two-phase bootstrap:
      Phase A (deterministic): one `column` row per column across all
        BOOTSTRAP_TABLES. Guaranteed full coverage.
      Phase B (LLM-drafted): 6–12 `metric` rows drafted against the same
        schema. If the local model fails or times out, Phase A still gives
        us a usable glossary.
    Admin-edited rows (source='admin') are ALWAYS preserved.
    """
    admin_terms = {
        t.term.lower() for t in list_terms(tenant_id=tenant_id)
        if t.source == "admin"
    }

    # Phase A — deterministic column walk.
    if overwrite_auto:
        conn = _conn()
        try:
            conn.execute(
                "DELETE FROM ai_glossary_terms "
                "WHERE tenant_id = ? AND source = 'auto'",
                (tenant_id,),
            )
            conn.commit()
        finally:
            conn.close()

    col_stats = _bootstrap_columns_deterministic(
        tenant_id=tenant_id,
        admin_terms=admin_terms,
        overwrite_auto=overwrite_auto,
    )

    # Phase B — ask the LLM for metric entries only. Failure here is not fatal.
    spec = introspect_schema()
    user_prompt = (
        "SCHEMA:\n"
        + json.dumps(spec, indent=2)
        + "\n\nDraft the metric entries now. Return only JSON."
    )
    drafted = chat_json(_METRIC_PROMPT, user_prompt, temperature=0.2)
    terms = drafted.get("terms") if isinstance(drafted, dict) else None
    terms = terms if isinstance(terms, list) else []
    inserted = col_stats["inserted"]
    updated = col_stats["updated"]
    # NOTE: the Phase-A DELETE already wiped auto rows; we don't repeat it
    # here or we'd lose every column entry we just inserted.
    conn = _conn()
    try:
        for raw in terms:
            if not isinstance(raw, dict):
                continue
            term = (raw.get("term") or "").strip()
            definition = (raw.get("definition") or "").strip()
            if not term or not definition:
                continue
            if term.lower() in admin_terms:
                continue  # never clobber an admin-owned term
            # Phase B rows are metrics by default — the Phase A pass owns
            # the 'column' category for name-shaped entries.
            category = raw.get("category") or "metric"
            if category not in CATEGORIES:
                category = "metric"
            synonyms = raw.get("synonyms")
            if not isinstance(synonyms, list):
                synonyms = []
            try:
                cur = conn.execute(
                    """INSERT INTO ai_glossary_terms
                         (term, definition, synonyms_json, table_hint,
                          column_hint, sql_template, category, source,
                          approved, tenant_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 'auto', 0, ?)
                       ON CONFLICT(tenant_id, term) DO UPDATE SET
                         definition   = excluded.definition,
                         synonyms_json= excluded.synonyms_json,
                         table_hint   = excluded.table_hint,
                         column_hint  = excluded.column_hint,
                         sql_template = excluded.sql_template,
                         category     = excluded.category,
                         source       = 'auto',
                         updated_at   = CURRENT_TIMESTAMP
                       WHERE ai_glossary_terms.source != 'admin'""",
                    (term, definition, json.dumps(synonyms),
                     raw.get("table_hint"), raw.get("column_hint"),
                     raw.get("sql_template"), category, tenant_id),
                )
                if cur.rowcount:
                    if cur.lastrowid:
                        inserted += 1
                    else:
                        updated += 1
            except sqlite3.Error as exc:
                log.warning("metric glossary insert failed for %s: %s", term, exc)
        conn.commit()
    finally:
        conn.close()
    # Reindex the whole glossary so agent retrieval reflects the new shape.
    reindex_vectors(tenant_id=tenant_id)
    return {
        "inserted": inserted,
        "updated": updated,
        "preserved_admin": len(admin_terms),
    }


# ---------- vector indexing + agent lookup -------------------------------

def _term_chunk_text(t: GlossaryTerm) -> str:
    """The text we embed. Flattens the row into a short, dense description
    so a query like "how many papers are waiting to be checked" resolves to
    "Pending documents" via cosine similarity."""
    parts = [t.term, t.definition]
    if t.synonyms:
        parts.append("Also known as: " + ", ".join(t.synonyms))
    if t.table_hint or t.column_hint:
        loc = ".".join(filter(None, [t.table_hint, t.column_hint]))
        parts.append(f"Refers to: {loc}")
    if t.sql_template:
        parts.append(f"SQL: {t.sql_template}")
    parts.append(f"Category: {t.category}")
    return " | ".join(parts)


def _vec_conn() -> sqlite3.Connection:
    VECTOR_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(VECTOR_DB_PATH), isolation_level=None)
    conn.execute("PRAGMA journal_mode = WAL")
    # Table exists if vectors module has been initialised already; create
    # defensively so we don't race with a cold start.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS docbrain_chunks (
            rowid        INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id    TEXT NOT NULL,
            document_id  INTEGER NOT NULL,
            chunk_index  INTEGER NOT NULL,
            text         TEXT NOT NULL,
            embedding    BLOB NOT NULL,
            UNIQUE(tenant_id, document_id, chunk_index)
        )
    """)
    return conn


def _encode(vec: List[float]) -> bytes:
    import struct
    return struct.pack(f"{len(vec)}f", *vec)


def _index_term(t: GlossaryTerm) -> None:
    """Upsert a single term into the vector store. chunk_index is the term id
    so we can O(1) replace / delete on subsequent updates."""
    vec = embed_text(_term_chunk_text(t))
    if not vec:
        return
    conn = _vec_conn()
    try:
        conn.execute(
            "DELETE FROM docbrain_chunks "
            "WHERE tenant_id = ? AND document_id = ? AND chunk_index = ?",
            (t.tenant_id, GLOSSARY_DOC_ID, t.id),
        )
        conn.execute(
            "INSERT INTO docbrain_chunks "
            "(tenant_id, document_id, chunk_index, text, embedding) "
            "VALUES (?, ?, ?, ?, ?)",
            (t.tenant_id, GLOSSARY_DOC_ID, t.id, _term_chunk_text(t), _encode(vec)),
        )
    finally:
        conn.close()


def _drop_term_chunk(term_id: int, *, tenant_id: str = "nbe") -> None:
    conn = _vec_conn()
    try:
        conn.execute(
            "DELETE FROM docbrain_chunks "
            "WHERE tenant_id = ? AND document_id = ? AND chunk_index = ?",
            (tenant_id, GLOSSARY_DOC_ID, term_id),
        )
    finally:
        conn.close()


def reindex_vectors(*, tenant_id: str = "nbe") -> int:
    """Rebuild the glossary vector index from scratch. Safe to call any time."""
    rows = list_terms(tenant_id=tenant_id)
    conn = _vec_conn()
    try:
        conn.execute(
            "DELETE FROM docbrain_chunks "
            "WHERE tenant_id = ? AND document_id = ?",
            (tenant_id, GLOSSARY_DOC_ID),
        )
    finally:
        conn.close()
    for t in rows:
        _index_term(t)
    return len(rows)


def search_glossary(
    query: str,
    *,
    tenant_id: str = "nbe",
    k: int = 5,
) -> List[Dict[str, Any]]:
    """Cosine-similarity search over glossary terms. Pure Python (numpy)
    so it doesn't require sqlite-vec to be loadable."""
    import numpy as np
    qvec = embed_text(query)
    if not qvec:
        return []
    conn = _vec_conn()
    try:
        rows = conn.execute(
            "SELECT chunk_index, text, embedding FROM docbrain_chunks "
            "WHERE tenant_id = ? AND document_id = ?",
            (tenant_id, GLOSSARY_DOC_ID),
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        return []
    q = np.array(qvec, dtype="<f4")
    q /= (np.linalg.norm(q) + 1e-12)
    embs = np.vstack([np.frombuffer(r[2], dtype="<f4") for r in rows])
    norms = np.linalg.norm(embs, axis=1) + 1e-12
    sims = (embs / norms[:, None]) @ q
    order = sims.argsort()[::-1][:k]
    # Rehydrate by id so the agent gets full metadata (not just the text blob).
    ids = [int(rows[i][0]) for i in order]
    conn = _conn()
    try:
        placeholders = ",".join("?" for _ in ids)
        rows_full = conn.execute(
            f"SELECT * FROM ai_glossary_terms WHERE id IN ({placeholders}) AND tenant_id = ?",
            (*ids, tenant_id),
        ).fetchall()
    finally:
        conn.close()
    by_id = {int(r["id"]): _hydrate(r).to_dict() for r in rows_full}
    return [by_id[i] for i in ids if i in by_id]


# ---------- helpers for the agent ----------------------------------------

def build_agent_preamble(*, tenant_id: str = "nbe", max_terms: int = 40) -> str:
    """A short textual dump of the approved glossary. Prepended to the agent
    system prompt so the LLM sees the admin-blessed vocabulary up front.

    Format is line-oriented and labels each field explicitly so the model
    doesn't copy annotation syntax into tool arguments verbatim. The SQL
    template is emitted as `WHERE <fragment>` — the agent should pass only
    the <fragment> as the `where` argument to aggregate_documents.
    """
    terms = [t for t in list_terms(tenant_id=tenant_id, approved=True)][:max_terms]
    if not terms:
        return ""
    lines = [
        "Approved glossary (prefer these terms when mapping user language to",
        "data tools). For metric terms, pass ONLY the SQL fragment after WHERE",
        "as the `where` argument to aggregate_documents — never include the",
        "WHERE keyword, the term name, or any surrounding punctuation.",
        "",
    ]
    for t in terms:
        lines.append(f"TERM: {t.term}")
        lines.append(f"  definition: {t.definition}")
        if t.table_hint:
            lines.append(f"  table: {t.table_hint}")
        if t.column_hint:
            lines.append(f"  column: {t.column_hint}")
        if t.sql_template:
            lines.append(f"  WHERE {t.sql_template}")
        lines.append("")
    return "\n".join(lines).rstrip()


def coverage_stats(*, tenant_id: str = "nbe") -> Dict[str, int]:
    """Counts used by the AI Engine page 'Glossary coverage' card."""
    conn = _conn()
    try:
        total = conn.execute(
            "SELECT COUNT(*) FROM ai_glossary_terms WHERE tenant_id = ?",
            (tenant_id,),
        ).fetchone()[0]
        approved = conn.execute(
            "SELECT COUNT(*) FROM ai_glossary_terms WHERE tenant_id = ? AND approved = 1",
            (tenant_id,),
        ).fetchone()[0]
        admin = conn.execute(
            "SELECT COUNT(*) FROM ai_glossary_terms WHERE tenant_id = ? AND source = 'admin'",
            (tenant_id,),
        ).fetchone()[0]
    finally:
        conn.close()
    return {"total": int(total), "approved": int(approved), "admin_edited": int(admin)}


__all__: Iterable[str] = (
    "GlossaryTerm",
    "CATEGORIES",
    "list_terms",
    "get_term",
    "create_term",
    "update_term",
    "delete_term",
    "introspect_schema",
    "bootstrap_from_llm",
    "reindex_vectors",
    "search_glossary",
    "build_agent_preamble",
    "coverage_stats",
)

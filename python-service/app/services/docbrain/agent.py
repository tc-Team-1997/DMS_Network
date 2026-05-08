"""DocBrain agent — tool-using answerer for DMS-wide questions.

Uses Ollama's native tool-calling (`tools=[...]` parameter, supported on
llama3.1, qwen2.5, mistral-nemo, etc.). We prefer the native path over
LangChain's agent abstractions because the latter has churned through
three incompatible APIs in the last year.

Tools are read-only and talk directly to the Node SQLite (NODE_DB_PATH
env, defaults to the repo's db/nbe-dms.db). No writes.

Streaming events (same shape as chat/stream, plus two new types):
  {"type": "tool_call",   "name": ..., "arguments": {...}}
  {"type": "tool_result", "name": ..., "result": "..."}
  {"type": "token",       "text": "..."}
  {"type": "done",        "iterations": N, "used_tools": [...]}
  {"type": "error",       "message": "..."}
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

import ollama

from .llm import CHAT_MODEL, OLLAMA_HOST
from .lc_rag import build_retriever, _dedup_docs, _hybrid_rerank, USE_HYBRID
from . import glossary as glossary_svc
from . import knowledge as dms_knowledge

log = logging.getLogger(__name__)

MAX_ITERATIONS = 4

AGENT_SYSTEM_PROMPT_BASE = """You are DocBrain, an AI assistant for the
National Bank of Egypt Document Management System (DMS). You answer user
questions by calling tools to look up information, then synthesising a
short, accurate response.

AVAILABLE TABLES (never invent others):
  documents, document_versions, document_type_schemas, folders,
  workflows, workflow_templates, alerts, notifications, retention_policies,
  audit_log, annotations, signatures, users.

TOOLING WORKFLOW
  1. Prefer calling a tool over guessing. Tools return ground truth from
     the live database or the DMS knowledge base.
  2. All `query` parameters accept a single PLAIN STRING. Never pass a
     JSON schema fragment or a dict like {"type":"string","description":…};
     pass the user's actual question text.
  3. For COUNT / aggregation questions ("how many", "break down by …"),
     first call `lookup_glossary`, then `aggregate_rows`. Pass the
     glossary's WHERE fragment verbatim as `where`. If a group_by is
     rejected, retry with group_by omitted — a total is better than an
     error.
  4. For "show me / list / compare X across Y" questions that expect
     rows rather than a count, call `list_rows` with the right table.
     Example: "compare retention policies across document types" →
     list_rows(table="retention_policies"). The user wants to see the
     rows, not a number.
  5. For NARRATIVE questions ("how does retention work", "walk me
     through the lifecycle", "what modules exist", "which roles can
     approve"), call `search_knowledge(query="…")` first — it returns
     authoritative sections from the DMS overview.
  6. For PASSAGE questions about the content of a specific document,
     call `find_documents(query="…")` or `get_document`.
  7. When a tool returns nothing or an error, DO NOT apologise and give
     up. Re-plan: pick a different tool, drop the offending argument,
     or call `search_knowledge` for context. Only tell the user you
     cannot answer if you've tried at least two tools.
  8. Keep the final answer CONCISE — one short paragraph or a 2–5 row
     summary. The SPA renders the tool result as a table or chart on
     its own, so you do NOT need to re-list every row in prose.
  9. When relevant, close with one sentence of insight ("The busiest
     branch this week is …", "No policy is set for Loan Applications —
     consider adding one").
 10. When you quote a document, cite it as `doc#<id>`.
"""


def _compose_system_prompt() -> str:
    """Prepend the approved glossary so the agent has admin-blessed vocabulary
    in-context. Rebuilt every request so admin edits apply immediately."""
    preamble = glossary_svc.build_agent_preamble()
    return f"{AGENT_SYSTEM_PROMPT_BASE}\n\n{preamble}" if preamble else AGENT_SYSTEM_PROMPT_BASE


# Kept as a module-level alias for any caller that imported the old name;
# the live prompt is composed per-request via _compose_system_prompt().
AGENT_SYSTEM_PROMPT = AGENT_SYSTEM_PROMPT_BASE


def _node_db_path() -> str:
    # Default points at the Node app's SQLite. Env override for CI / tests.
    env = os.environ.get("NODE_DB_PATH")
    if env:
        return env
    # python-service/ → project root → db/nbe-dms.db
    return str((Path(__file__).resolve().parents[4] / "db" / "nbe-dms.db"))


def _node_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_node_db_path())
    conn.row_factory = sqlite3.Row
    return conn


# ---------- tool implementations -----------------------------------------

def _tool_find_documents(query: str, k: int = 5) -> List[Dict[str, Any]]:
    """Semantic search across the indexed corpus. Uses the same layered
    retriever as /chat/stream so results are consistent with the Viewer's
    RAG panel."""
    retriever = build_retriever(k=max(k * 2, 10))
    docs = retriever.invoke(query)
    docs = _dedup_docs(docs)
    docs = _hybrid_rerank(query, docs, top_k=k) if USE_HYBRID else docs[:k]
    return [
        {
            "document_id": int(d.metadata.get("document_id", 0)),
            "chunk_index": int(d.metadata.get("chunk_index", 0)),
            "snippet": d.page_content[:300],
        }
        for d in docs
    ]


def _tool_list_expiring(days: int = 30) -> List[Dict[str, Any]]:
    """Documents with expiry_date within the next N days."""
    conn = _node_conn()
    try:
        rows = conn.execute(
            """
            SELECT id, original_name, doc_type, customer_name, customer_cid,
                   expiry_date, branch, status
            FROM documents
            WHERE expiry_date IS NOT NULL
              AND expiry_date >= date('now')
              AND expiry_date <= date('now', ? )
            ORDER BY expiry_date ASC
            LIMIT 25
            """,
            (f"+{int(days)} days",),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _tool_list_workflows(stage: Optional[str] = None,
                         priority: Optional[str] = None) -> List[Dict[str, Any]]:
    """Workflows, optionally filtered by stage or priority."""
    conn = _node_conn()
    try:
        sql = (
            "SELECT id, ref_code, title, doc_id, stage, priority, updated_at "
            "FROM workflows WHERE 1=1"
        )
        params: List[Any] = []
        if stage:
            sql += " AND stage = ?"
            params.append(stage)
        if priority:
            sql += " AND priority = ?"
            params.append(priority)
        sql += " ORDER BY updated_at DESC LIMIT 25"
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def _tool_list_alerts(level: Optional[str] = None,
                      unread_only: bool = False) -> List[Dict[str, Any]]:
    """Alerts feed, optionally filtered by level/unread."""
    conn = _node_conn()
    try:
        sql = "SELECT id, level, title, meta, is_read, created_at FROM alerts WHERE 1=1"
        params: List[Any] = []
        if level:
            sql += " AND level = ?"
            params.append(level)
        if unread_only:
            sql += " AND is_read = 0"
        sql += " ORDER BY created_at DESC LIMIT 25"
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def _tool_get_document(document_id: int) -> Optional[Dict[str, Any]]:
    """Full row for one document."""
    conn = _node_conn()
    try:
        row = conn.execute(
            "SELECT * FROM documents WHERE id = ?", (int(document_id),),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _tool_count_by_status() -> Dict[str, int]:
    """Status histogram across the repository."""
    conn = _node_conn()
    try:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS c FROM documents GROUP BY status"
        ).fetchall()
        return {r["status"]: int(r["c"]) for r in rows}
    finally:
        conn.close()


# ---------- analytics tools (glossary-driven) -----------------------------

# Whitelists kept explicit so an LLM-generated table / group_by / filter
# can never smuggle in arbitrary SQL. Anything not in these sets is
# rejected. Columns listed here double as (a) safe group_by keys and
# (b) safe time-window columns when since_days / until_days are provided.
_AGG_COLUMNS: Dict[str, set] = {
    "documents": {
        "id", "doc_type", "branch", "status", "customer_cid", "customer_name",
        "uploaded_at", "expiry_date", "issue_date", "issuing_authority",
    },
    "workflows": {
        "id", "stage", "priority", "doc_id", "created_at", "updated_at",
    },
    "workflow_templates": {
        "id", "name", "doc_type", "created_at",
    },
    "alerts": {
        "id", "level", "is_read", "created_at",
    },
    "folders": {
        "id", "name", "parent_id",
    },
    "document_versions": {
        "id", "document_id", "version", "created_at",
    },
    "document_type_schemas": {
        "id", "name", "active", "tenant_id", "created_at",
    },
    "retention_policies": {
        "id", "doc_type", "retention_years", "auto_purge",
    },
    "audit_log": {
        "id", "user_id", "action", "entity_type", "entity_id",
        "tenant_id", "created_at",
    },
    "annotations": {
        "id", "document_id", "user_id", "created_at",
    },
    "signatures": {
        "id", "document_id", "user_id", "status", "created_at",
    },
    "notifications": {
        "id", "user_id", "type", "is_read", "created_at",
    },
    "users": {
        "id", "role", "branch", "status",
    },
}

# For each table, the column we treat as "when did this row happen?" so a
# since_days / until_days filter works without the agent having to know the
# per-table naming convention.
_TIME_COLUMN: Dict[str, str] = {
    "documents":             "uploaded_at",
    "workflows":             "updated_at",
    "workflow_templates":    "created_at",
    "alerts":                "created_at",
    "folders":               "created_at",   # may not exist; guarded at runtime
    "document_versions":     "created_at",
    "document_type_schemas": "created_at",
    "retention_policies":    "created_at",   # may not exist; guarded at runtime
    "audit_log":             "created_at",
    "annotations":           "created_at",
    "signatures":            "created_at",
    "notifications":         "created_at",
    "users":                 "created_at",   # may not exist; guarded at runtime
}


def _safe_sql_fragment(fragment: Optional[str]) -> Optional[str]:
    """Reject SQL fragments that contain statement separators or DDL verbs.
    Also reject fragments that aren't a boolean expression (small models
    sometimes pass a bare column name like `doc_type` which SQLite happily
    evaluates, silently filtering out the whole result set)."""
    if not fragment:
        return None
    f = fragment.strip().rstrip(";").strip("()").strip()
    if not f:
        return None
    lowered = f.lower()
    banned = (";", "--", "/*", "*/", "drop ", "delete ", "update ",
              "insert ", "alter ", "attach ", "pragma ")
    if any(tok in lowered for tok in banned):
        return None
    # Must look like a boolean expression — at least one operator / keyword.
    required_markers = ("=", "!=", "<>", "<", ">", " is ", " like ",
                        " between ", " in ", " not ", " and ", " or ")
    padded = f" {lowered} "
    if not any(m in padded for m in required_markers):
        return None
    return f


def _tool_lookup_glossary(query: Any = "", k: Any = 5) -> List[Dict[str, Any]]:
    """Semantic search across the glossary. Returns the top-k terms with
    their definition, table/column hint, and SQL template so the agent can
    compose a correct aggregate query."""
    q = _coerce_str(query)
    if not q:
        return [{"error": "missing query"}]
    return glossary_svc.search_glossary(q, k=max(1, min(_coerce_int(k, 5) or 5, 10)))


def _tool_search_knowledge(query: Any = "", k: Any = 4) -> List[Dict[str, Any]]:
    """Semantic search across the DMS knowledge base (narrative sections
    describing modules, roles, retention, workflows, integrations, etc.).
    Use this when the user asks how something works, what something means,
    or which module owns a concept — not for counting or filtering data."""
    q = _coerce_str(query)
    if not q:
        return [{"error": "missing query"}]
    return dms_knowledge.search(q, k=max(1, min(_coerce_int(k, 4) or 4, 8)))


def _tool_find_documents_safe(query: Any = "", k: Any = 5) -> List[Dict[str, Any]]:
    """Wrapper around _tool_find_documents that coerces the query arg."""
    q = _coerce_str(query)
    if not q:
        return [{"error": "missing query"}]
    return _tool_find_documents(q, k=max(1, min(_coerce_int(k, 5) or 5, 10)))


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    """Defensive check — some tables declared in _TIME_COLUMN may not have
    a `created_at` (older migrations). Avoids a hard SQL error on time
    filters and lets the agent degrade to unfiltered aggregation."""
    try:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    except sqlite3.Error:
        return False
    return any(r["name"] == column for r in rows)


def _coerce_int(val: Any, default: Optional[int]) -> Optional[int]:
    """Small models happily pass `null` or empty strings for optional int
    parameters. Accept any reasonable shape; fall back to the default."""
    if val is None or val == "":
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _coerce_str(val: Any) -> str:
    """Llama3.2:3b sometimes passes a tool's parameter *schema* as the
    argument value (e.g. `{"query": {"type": "string", "description": "…"}}`).
    Extract any useful string we can find so the tool still runs instead of
    erroring out. Last resort: empty string — the tool will decide what to
    do with it."""
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, dict):
        # If it looks like a JSON-schema stub, prefer the description; else
        # pick the first string value in the dict.
        for key in ("query", "description", "value", "term"):
            v = val.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        for v in val.values():
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""
    return str(val) if val is not None else ""


def _tool_aggregate_rows(
    *,
    table: str = "documents",
    group_by: Optional[str] = None,
    since_days: Any = None,
    until_days: Any = None,
    where: Optional[str] = None,
    limit: Any = 25,
    **_legacy: Any,
) -> Dict[str, Any]:
    """Generic COUNT(*) aggregation with per-table whitelists.

    Safe by construction:
      - `table` must be in _AGG_COLUMNS (rejects any other identifier).
      - `group_by` must be in _AGG_COLUMNS[table].
      - `where` is vetted by _safe_sql_fragment; in practice the agent
        lifts it verbatim from a glossary sql_template.
      - since_days / until_days resolve to the table's _TIME_COLUMN —
        skipped if that column doesn't exist on this table.
    """
    cols = _AGG_COLUMNS.get(table)
    if cols is None:
        return {"error": f"table must be one of {sorted(_AGG_COLUMNS.keys())}"}
    # Small models sometimes pick a column that doesn't exist on this
    # table. Rather than erroring, drop the group_by and fall back to a
    # scalar total — the UI can still render something useful and the
    # user avoids a dead-end "I couldn't find…" response.
    dropped_group_by: Optional[str] = None
    if group_by and group_by not in cols:
        dropped_group_by = group_by
        group_by = None
    time_col = _TIME_COLUMN.get(table)
    since_days_i = _coerce_int(since_days, None)
    until_days_i = _coerce_int(until_days, None)
    limit_i = _coerce_int(limit, 25) or 25

    conn = _node_conn()
    try:
        # Strip filters whose time column isn't present on this table so the
        # agent's default since_days doesn't blow up across every table.
        effective_time_col = time_col if (time_col and _column_exists(conn, table, time_col)) else None

        sql_parts = ["SELECT"]
        if group_by:
            sql_parts.append(f"{group_by} AS bucket, COUNT(*) AS c")
        else:
            sql_parts.append("COUNT(*) AS c")
        sql_parts.append(f"FROM {table} WHERE 1=1")
        params: List[Any] = []
        if since_days_i is not None and effective_time_col:
            sql_parts.append(f"AND {effective_time_col} >= datetime('now', ?)")
            params.append(f"-{since_days_i} day")
        if until_days_i is not None and effective_time_col:
            sql_parts.append(f"AND {effective_time_col} <= datetime('now', ?)")
            params.append(f"-{until_days_i} day")
        safe_where = _safe_sql_fragment(where)
        if safe_where:
            sql_parts.append(f"AND ({safe_where})")
        if group_by:
            sql_parts.append(f"GROUP BY {group_by} ORDER BY c DESC LIMIT ?")
            params.append(limit_i)
        sql = " ".join(sql_parts)
        rows = conn.execute(sql, params).fetchall()
        if group_by:
            out = {
                "table": table,
                "total": sum(int(r["c"]) for r in rows),
                "buckets": [{"bucket": r["bucket"], "count": int(r["c"])} for r in rows],
                "sql": sql,
            }
            if dropped_group_by:
                out["note"] = f"group_by '{dropped_group_by}' not on this table"
            return out
        out = {
            "table": table,
            "total": int(rows[0]["c"]) if rows else 0,
            "sql": sql,
        }
        if dropped_group_by:
            out["note"] = f"group_by '{dropped_group_by}' not on this table; returned scalar total instead"
        return out
    except sqlite3.Error as exc:
        return {"error": str(exc)}
    finally:
        conn.close()


def _tool_aggregate_documents(**kwargs: Any) -> Dict[str, Any]:
    """Backward-compatible shim — forwards to aggregate_rows(table='documents').
    Accepts the old documents-specific filters (status / doc_type / branch)
    and converts them into an equality WHERE fragment."""
    equality_filters: List[str] = []
    for key in ("status", "doc_type", "branch"):
        val = kwargs.pop(key, None)
        if val is not None and val != "":
            escaped = str(val).replace("'", "''")
            equality_filters.append(f"{key} = '{escaped}'")
    if equality_filters:
        existing = kwargs.get("where")
        combined = " AND ".join(equality_filters)
        kwargs["where"] = f"({combined}) AND ({existing})" if existing else combined
    kwargs.setdefault("table", "documents")
    return _tool_aggregate_rows(**kwargs)


def _tool_activity_feed(since_days: Any = 7, limit: Any = 25) -> List[Dict[str, Any]]:
    """Union of recent document uploads and workflow stage changes. Useful
    for the 'what happened in the last N days' family of questions."""
    days = max(1, _coerce_int(since_days, 7) or 7)
    lim = max(1, min(_coerce_int(limit, 25) or 25, 100))
    conn = _node_conn()
    try:
        docs = conn.execute(
            """SELECT 'document_upload' AS kind, id, original_name AS title,
                      uploaded_at AS at, doc_type, branch, status
               FROM documents
               WHERE uploaded_at >= datetime('now', ?)
               ORDER BY uploaded_at DESC LIMIT ?""",
            (f"-{days} day", lim),
        ).fetchall()
        flows = conn.execute(
            """SELECT 'workflow' AS kind, id, title, updated_at AS at,
                      stage AS status, priority, doc_id
               FROM workflows
               WHERE updated_at >= datetime('now', ?)
               ORDER BY updated_at DESC LIMIT ?""",
            (f"-{days} day", lim),
        ).fetchall()
        merged = [dict(r) for r in list(docs) + list(flows)]
        merged.sort(key=lambda r: r.get("at") or "", reverse=True)
        return merged[:lim]
    finally:
        conn.close()


def _tool_list_rows(
    *,
    table: str = "documents",
    where: Optional[str] = None,
    order_by: Optional[str] = None,
    limit: Any = 25,
) -> Dict[str, Any]:
    """List rows from any whitelisted table. Use for 'show me / compare /
    list all X' questions where the user wants to see the records, not a
    count. Columns returned are bounded to the table's whitelist so we
    don't leak internal columns accidentally."""
    cols = _AGG_COLUMNS.get(table)
    if cols is None:
        return {"error": f"table must be one of {sorted(_AGG_COLUMNS.keys())}"}
    limit_i = max(1, min(_coerce_int(limit, 25) or 25, 100))
    # Select the whitelisted columns so the payload stays deterministic.
    # Some columns are useful for humans but not part of the whitelist —
    # opportunistically add the common name/label fields.
    keep = list(cols)
    for extra in ("original_name", "title", "name", "ref_code"):
        if extra not in keep:
            keep.append(extra)
    conn = _node_conn()
    try:
        present = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        select_cols = [c for c in keep if c in present]
        if not select_cols:
            return {"error": f"no whitelisted columns available on {table}"}
        sql_parts = [f"SELECT {', '.join(select_cols)} FROM {table} WHERE 1=1"]
        safe_where = _safe_sql_fragment(where)
        if safe_where:
            sql_parts.append(f"AND ({safe_where})")
        if order_by and order_by in present:
            sql_parts.append(f"ORDER BY {order_by} DESC")
        elif "created_at" in present:
            sql_parts.append("ORDER BY created_at DESC")
        elif "id" in present:
            sql_parts.append("ORDER BY id DESC")
        sql_parts.append("LIMIT ?")
        sql = " ".join(sql_parts)
        rows = [dict(r) for r in conn.execute(sql, [limit_i]).fetchall()]
        return {"table": table, "rows": rows, "count": len(rows), "sql": sql}
    except sqlite3.Error as exc:
        return {"error": str(exc)}
    finally:
        conn.close()


def _tool_processing_rate(bucket: str = "day", window_days: Any = 14) -> List[Dict[str, Any]]:
    """Histogram of documents uploaded per day/week across the window."""
    window = max(1, _coerce_int(window_days, 14) or 14)
    if bucket == "week":
        fmt = "%Y-W%W"
    elif bucket == "month":
        fmt = "%Y-%m"
    else:
        fmt = "%Y-%m-%d"
    conn = _node_conn()
    try:
        rows = conn.execute(
            f"""SELECT strftime(?, uploaded_at) AS bucket, COUNT(*) AS c
                FROM documents
                WHERE uploaded_at >= datetime('now', ?)
                GROUP BY bucket
                ORDER BY bucket ASC""",
            (fmt, f"-{window} day"),
        ).fetchall()
        return [{"bucket": r["bucket"], "count": int(r["c"])} for r in rows]
    finally:
        conn.close()


TOOL_REGISTRY: Dict[str, Any] = {
    "find_documents":       _tool_find_documents_safe,
    "list_expiring":        _tool_list_expiring,
    "list_workflows":       _tool_list_workflows,
    "list_alerts":          _tool_list_alerts,
    "get_document":         _tool_get_document,
    "count_by_status":      _tool_count_by_status,
    # analytics tools
    "lookup_glossary":      _tool_lookup_glossary,
    "search_knowledge":     _tool_search_knowledge,
    "aggregate_rows":       _tool_aggregate_rows,
    "aggregate_documents":  _tool_aggregate_documents,   # legacy alias
    "list_rows":            _tool_list_rows,
    "activity_feed":        _tool_activity_feed,
    "processing_rate":      _tool_processing_rate,
}


# JSON-schema descriptors, per Ollama's tools= format (OpenAI-compatible).
TOOL_SCHEMAS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "find_documents",
            "description": "Semantic search across the document corpus. Returns relevant chunks with doc ids.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Free-text query"},
                    "k": {"type": "integer", "description": "Number of results (default 5)"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_expiring",
            "description": "List documents whose expiry date falls within the next N days. Use for compliance questions about upcoming renewals.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "description": "Look-ahead window in days (default 30)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_workflows",
            "description": "List workflows, optionally filtered by stage (e.g. 'Maker Review', 'Approved') or priority (High | Medium | Low).",
            "parameters": {
                "type": "object",
                "properties": {
                    "stage": {"type": "string"},
                    "priority": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_alerts",
            "description": "List alerts, optionally filtered by level (critical | warning | info | success) or unread.",
            "parameters": {
                "type": "object",
                "properties": {
                    "level": {"type": "string"},
                    "unread_only": {"type": "boolean"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_document",
            "description": "Fetch a single document row by id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "document_id": {"type": "integer"},
                },
                "required": ["document_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "count_by_status",
            "description": "Return a histogram of documents by status (Valid / Expiring / Expired / etc).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_glossary",
            "description": ("Semantic search across the editable business glossary. Call this FIRST "
                            "for any analytics question so you map the user's wording (e.g. "
                            "'pending', 'processed', 'recently uploaded') to a concrete table, "
                            "column, and SQL filter template before aggregating."),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "User question or phrase to resolve."},
                    "k":     {"type": "integer", "description": "How many terms to return (1..10)."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": ("Retrieve authoritative narrative sections from the DMS knowledge base "
                            "(modules, user roles, document lifecycle, retention policies, "
                            "workflow engine, alerts, AI engine, schema, integrations, compliance). "
                            "Use for 'how does X work', 'what is X', 'walk me through X' questions. "
                            "Always prefer this over inventing an explanation."),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "User question or topic to look up."},
                    "k":     {"type": "integer", "description": "How many sections to return (1..8)."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "aggregate_rows",
            "description": ("COUNT(*) over any whitelisted table (documents, workflows, "
                            "workflow_templates, alerts, folders, document_versions, "
                            "document_type_schemas, retention_policies, audit_log, "
                            "annotations, signatures, notifications, users) with safe filters. "
                            "Use the `where` fragment lifted verbatim from a glossary term's "
                            "sql_template. Supports optional time window (since_days / "
                            "until_days, auto-bound to each table's activity column) and group_by."),
            "parameters": {
                "type": "object",
                "properties": {
                    "table":      {"type": "string", "description": "Table to aggregate. Required."},
                    "group_by":   {"type": "string", "description": "Column to group by. Must be a whitelisted column on the chosen table."},
                    "since_days": {"type": "integer", "description": "Only count rows newer than N days."},
                    "until_days": {"type": "integer", "description": "Only count rows older than N days."},
                    "where":      {"type": "string", "description": "SQL WHERE fragment from a glossary sql_template. No semicolons or DDL."},
                    "limit":      {"type": "integer"},
                },
                "required": ["table"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "aggregate_documents",
            "description": ("Convenience alias for aggregate_rows with table='documents'. "
                            "Use aggregate_rows when the user's question targets any other table."),
            "parameters": {
                "type": "object",
                "properties": {
                    "group_by":   {"type": "string"},
                    "since_days": {"type": "integer"},
                    "until_days": {"type": "integer"},
                    "status":     {"type": "string"},
                    "doc_type":   {"type": "string"},
                    "branch":     {"type": "string"},
                    "where":      {"type": "string"},
                    "limit":      {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_rows",
            "description": ("Return actual rows (not counts) from a whitelisted table. Use for "
                            "'show me / list / compare X' questions where the user wants to see "
                            "the records themselves — e.g. 'compare retention policies across "
                            "doc types' → list_rows(table='retention_policies'). Same table "
                            "whitelist as aggregate_rows."),
            "parameters": {
                "type": "object",
                "properties": {
                    "table":    {"type": "string", "description": "Which table to list from. Required."},
                    "where":    {"type": "string", "description": "Optional SQL WHERE fragment from a glossary sql_template."},
                    "order_by": {"type": "string", "description": "Column to sort by (descending). Must be on the table."},
                    "limit":    {"type": "integer"},
                },
                "required": ["table"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "activity_feed",
            "description": "Merged feed of recent document uploads and workflow stage changes in the last N days.",
            "parameters": {
                "type": "object",
                "properties": {
                    "since_days": {"type": "integer", "description": "Look-back window in days (default 7)."},
                    "limit":      {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "processing_rate",
            "description": "Documents-uploaded histogram bucketed by day, week, or month over a rolling window.",
            "parameters": {
                "type": "object",
                "properties": {
                    "bucket":      {"type": "string", "description": "day | week | month"},
                    "window_days": {"type": "integer"},
                },
            },
        },
    },
]


# ---------- agent loop ----------------------------------------------------

@dataclass
class AgentStep:
    name: str
    arguments: Dict[str, Any]
    result: Any


def _run_tool(name: str, arguments: Dict[str, Any]) -> Any:
    fn = TOOL_REGISTRY.get(name)
    if fn is None:
        return {"error": f"unknown tool {name}"}
    try:
        return fn(**(arguments or {}))
    except TypeError as exc:
        return {"error": f"invalid arguments: {exc}"}
    except Exception as exc:  # noqa: BLE001
        log.exception("tool %s failed: %s", name, exc)
        return {"error": str(exc)[:200]}


def agent_stream(
    question: str,
    *,
    history: Optional[List[Dict[str, str]]] = None,
) -> Iterator[Dict[str, Any]]:
    """Run the tool-calling loop and stream events."""
    if not question or not question.strip():
        yield {"type": "error", "message": "empty question"}
        return

    client = ollama.Client(host=OLLAMA_HOST)

    messages: List[Dict[str, Any]] = [{"role": "system", "content": _compose_system_prompt()}]
    for turn in (history or [])[-6:]:
        role = turn.get("role")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question.strip()})

    used_tools: List[str] = []
    for iteration in range(MAX_ITERATIONS):
        try:
            resp = client.chat(
                model=CHAT_MODEL,
                messages=messages,
                tools=TOOL_SCHEMAS,
                options={"temperature": 0.1},
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("ollama chat with tools failed: %s", exc)
            yield {"type": "error", "message": str(exc)[:200]}
            return

        # The ollama library returns ChatResponse pydantic objects; fall back
        # to the dict access for older versions that still return raw dicts.
        if isinstance(resp, dict):
            msg_raw = resp.get("message", {}) or {}
            tool_calls = msg_raw.get("tool_calls") or []
            assistant_content = msg_raw.get("content") or ""
        else:
            msg_obj = getattr(resp, "message", None)
            tool_calls = getattr(msg_obj, "tool_calls", None) or []
            assistant_content = getattr(msg_obj, "content", "") or ""
        if tool_calls:
            messages.append({
                "role": "assistant",
                "content": assistant_content,
                "tool_calls": [_tool_call_to_dict(c) for c in tool_calls],
            })
            for call in tool_calls:
                if isinstance(call, dict):
                    fn = call.get("function", {}) or {}
                    name = fn.get("name") or ""
                    raw_args = fn.get("arguments") or {}
                else:
                    fn_obj = getattr(call, "function", None)
                    name = getattr(fn_obj, "name", "") if fn_obj is not None else ""
                    raw_args = getattr(fn_obj, "arguments", {}) if fn_obj is not None else {}
                arguments = raw_args if isinstance(raw_args, dict) else _parse_args(raw_args)
                yield {"type": "tool_call", "name": name, "arguments": arguments}
                result = _run_tool(name, arguments)
                used_tools.append(name)
                result_text = json.dumps(result, default=str)[:4000]
                yield {"type": "tool_result", "name": name, "result": result}
                messages.append({
                    "role": "tool",
                    "content": result_text,
                    "tool_call_id": call.get("id") or name,
                })
            # Go around again so the model can incorporate tool results.
            continue

        # Final answer — stream it token by token.
        content = assistant_content
        if content:
            # Re-stream in small chunks for UX parity with chat/stream.
            # (Ollama.chat returns one blob when `stream=False`; we chunk it.)
            for piece in _chunk(content, size=24):
                yield {"type": "token", "text": piece}
        yield {
            "type": "done",
            "iterations": iteration + 1,
            "used_tools": used_tools,
        }
        return

    # Ran out of iterations — bail gracefully.
    yield {"type": "error", "message": "max tool iterations reached"}


def _parse_args(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return {}


def _tool_call_to_dict(call: Any) -> Dict[str, Any]:
    """Ollama's history round-trip needs a plain dict — ChatResponse carries
    pydantic ToolCall objects that don't JSON-serialise cleanly otherwise."""
    if isinstance(call, dict):
        return call
    fn = getattr(call, "function", None)
    return {
        "id": getattr(call, "id", None) or getattr(fn, "name", ""),
        "function": {
            "name": getattr(fn, "name", "") if fn is not None else "",
            "arguments": getattr(fn, "arguments", {}) if fn is not None else {},
        },
    }


def _chunk(text: str, *, size: int) -> Iterator[str]:
    for i in range(0, len(text), size):
        yield text[i: i + size]

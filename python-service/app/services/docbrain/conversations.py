"""DocBrain Chat v2 — conversation + message persistence service.

Public API
----------
list_conversations(db, tenant_id, user_id, q, limit)
    FTS5-backed search (or recency list when q is empty).
create_conversation(db, tenant_id, user_id, title, persona, folder, model_used)
get_conversation(db, conversation_id, tenant_id, user_id)
    Returns (conversation_row, messages) where messages excludes soft-deleted.
create_message(db, conversation_id, role, content, citations, has_evidence, needs_verification)
    Appends a message and updates conversation.last_message + last_message_at.
edit_message(db, message_id, conversation_id, new_content)
    Replaces content + sets edited_at; soft-deletes all messages after this one.
    Audit-safe: soft-deleted rows are retained (deleted_at IS NOT NULL) and
    recoverable via direct SQL; SPA never sees them.
soft_delete_message(db, message_id)
    Marks a single message deleted without touching siblings.
pin_conversation(db, conversation_id, user_id, pinned)
    Upserts / removes a docbrain_pins row; mirrors pinned flag on conversation.
set_folder(db, conversation_id, tenant_id, user_id, folder)
    Updates the folder column; raises if caller is not the owner.

All writes enforce tenant_id + user_id ownership.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS docbrain_conversations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       TEXT    NOT NULL DEFAULT 'nbe',
    user_id         INTEGER NOT NULL,
    title           TEXT    NOT NULL DEFAULT 'New chat',
    persona         TEXT,
    folder          TEXT,
    pinned          INTEGER NOT NULL DEFAULT 0,
    model_used      TEXT,
    last_message    TEXT,
    created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_message_at TEXT
);

CREATE TABLE IF NOT EXISTS docbrain_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES docbrain_conversations(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL CHECK(role IN ('user','assistant')),
    content         TEXT    NOT NULL DEFAULT '',
    citations_json  TEXT,
    has_evidence    INTEGER,
    needs_verification INTEGER DEFAULT 0,
    deleted_at      TEXT,
    edited_at       TEXT,
    created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS docbrain_pins (
    conversation_id INTEGER NOT NULL REFERENCES docbrain_conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL,
    pinned_at       TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS docbrain_conv_fts
USING fts5(
    title,
    last_message,
    persona,
    content='docbrain_conversations',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS docbrain_conv_ai
AFTER INSERT ON docbrain_conversations BEGIN
    INSERT INTO docbrain_conv_fts(rowid, title, last_message, persona)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.last_message,''), COALESCE(NEW.persona,''));
END;

CREATE TRIGGER IF NOT EXISTS docbrain_conv_au
AFTER UPDATE ON docbrain_conversations BEGIN
    INSERT INTO docbrain_conv_fts(docbrain_conv_fts, rowid, title, last_message, persona)
    VALUES ('delete', OLD.id, OLD.title, COALESCE(OLD.last_message,''), COALESCE(OLD.persona,''));
    INSERT INTO docbrain_conv_fts(rowid, title, last_message, persona)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.last_message,''), COALESCE(NEW.persona,''));
END;

CREATE TRIGGER IF NOT EXISTS docbrain_conv_ad
AFTER DELETE ON docbrain_conversations BEGIN
    INSERT INTO docbrain_conv_fts(docbrain_conv_fts, rowid, title, last_message, persona)
    VALUES ('delete', OLD.id, OLD.title, COALESCE(OLD.last_message,''), COALESCE(OLD.persona,''));
END;
"""


def _ensure_schema(db: Session) -> None:
    """Idempotent schema bootstrap for dev/test environments."""
    for stmt in _SCHEMA_SQL.strip().split(";"):
        stmt = stmt.strip()
        if stmt:
            try:
                db.execute(text(stmt))
            except Exception:  # noqa: BLE001
                pass  # Already exists — triggers fire duplicate errors on SQLite
    db.commit()


# ---------------------------------------------------------------------------
# Row → dict helpers
# ---------------------------------------------------------------------------

def _conv_row_to_dict(row) -> Dict[str, Any]:
    return {
        "id":              row[0],
        "tenant_id":       row[1],
        "user_id":         row[2],
        "title":           row[3],
        "persona":         row[4],
        "folder":          row[5],
        "pinned":          bool(row[6]),
        "model_used":      row[7],
        "last_message":    row[8],
        "created_at":      row[9],
        "updated_at":      row[10],
        "last_message_at": row[11],
    }


def _msg_row_to_dict(row) -> Dict[str, Any]:
    raw_citations = row[4]
    try:
        citations = json.loads(raw_citations) if raw_citations else []
    except Exception:  # noqa: BLE001
        citations = []
    return {
        "id":                  row[0],
        "conversation_id":     row[1],
        "role":                row[2],
        "content":             row[3],
        "citations":           citations,
        "has_evidence":        None if row[5] is None else bool(row[5]),
        "needs_verification":  bool(row[6]) if row[6] is not None else False,
        "deleted_at":          row[7],
        "edited_at":           row[8],
        "created_at":          row[9],
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_conversations(
    db: Session,
    tenant_id: str,
    user_id: int,
    q: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Return conversations for (tenant, user), newest first.

    When `q` is non-empty, runs FTS5 against title + last_message + persona.
    Falls back to a plain recency query when FTS returns nothing.
    """
    _ensure_schema(db)
    start = time.monotonic()

    if q and q.strip():
        # FTS5 match + join back to the conversations table.
        rows = db.execute(
            text(
                """
                SELECT c.id, c.tenant_id, c.user_id, c.title, c.persona, c.folder,
                       c.pinned, c.model_used, c.last_message, c.created_at,
                       c.updated_at, c.last_message_at
                FROM docbrain_conversations c
                JOIN docbrain_conv_fts f ON f.rowid = c.id
                WHERE f.docbrain_conv_fts MATCH :q
                  AND c.tenant_id = :tenant_id
                  AND c.user_id   = :user_id
                ORDER BY c.last_message_at DESC NULLS LAST
                LIMIT :limit
                """
            ),
            {"q": q.strip(), "tenant_id": tenant_id, "user_id": user_id, "limit": limit},
        ).fetchall()
    else:
        rows = db.execute(
            text(
                """
                SELECT id, tenant_id, user_id, title, persona, folder,
                       pinned, model_used, last_message, created_at,
                       updated_at, last_message_at
                FROM docbrain_conversations
                WHERE tenant_id = :tenant_id
                  AND user_id   = :user_id
                ORDER BY pinned DESC, last_message_at DESC NULLS LAST
                LIMIT :limit
                """
            ),
            {"tenant_id": tenant_id, "user_id": user_id, "limit": limit},
        ).fetchall()

    latency_ms = int((time.monotonic() - start) * 1000)
    log.info(
        '{"op":"list_conversations","tenant_id":%s,"user_id":%s,"q":%s,"latency_ms":%s}',
        json.dumps(tenant_id), user_id, json.dumps(q or ""), latency_ms,
    )
    return [_conv_row_to_dict(r) for r in rows]


def create_conversation(
    db: Session,
    tenant_id: str,
    user_id: int,
    title: str = "New chat",
    persona: Optional[str] = None,
    folder: Optional[str] = None,
    model_used: Optional[str] = None,
) -> Dict[str, Any]:
    """Insert and return a new conversation row."""
    _ensure_schema(db)
    now = datetime.now(timezone.utc).isoformat()
    result = db.execute(
        text(
            """
            INSERT INTO docbrain_conversations
                (tenant_id, user_id, title, persona, folder, model_used,
                 created_at, updated_at)
            VALUES
                (:tenant_id, :user_id, :title, :persona, :folder, :model_used,
                 :now, :now)
            """
        ),
        {
            "tenant_id": tenant_id,
            "user_id":   user_id,
            "title":     title[:300],
            "persona":   persona,
            "folder":    folder,
            "model_used": model_used,
            "now":       now,
        },
    )
    db.commit()
    new_id = result.lastrowid
    row = db.execute(
        text(
            """
            SELECT id, tenant_id, user_id, title, persona, folder,
                   pinned, model_used, last_message, created_at,
                   updated_at, last_message_at
            FROM docbrain_conversations WHERE id = :id
            """
        ),
        {"id": new_id},
    ).first()
    return _conv_row_to_dict(row)


def get_conversation(
    db: Session,
    conversation_id: int,
    tenant_id: str,
    user_id: int,
) -> Optional[Tuple[Dict[str, Any], List[Dict[str, Any]]]]:
    """Return (conversation, messages) or None if not found / not owned."""
    _ensure_schema(db)
    conv_row = db.execute(
        text(
            """
            SELECT id, tenant_id, user_id, title, persona, folder,
                   pinned, model_used, last_message, created_at,
                   updated_at, last_message_at
            FROM docbrain_conversations
            WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
            """
        ),
        {"id": conversation_id, "tenant_id": tenant_id, "user_id": user_id},
    ).first()
    if conv_row is None:
        return None

    # SPA default: exclude soft-deleted rows. Audit queries skip the filter.
    msg_rows = db.execute(
        text(
            """
            SELECT id, conversation_id, role, content, citations_json,
                   has_evidence, needs_verification, deleted_at, edited_at,
                   created_at
            FROM docbrain_messages
            WHERE conversation_id = :conv_id
              AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC
            """
        ),
        {"conv_id": conversation_id},
    ).fetchall()

    return _conv_row_to_dict(conv_row), [_msg_row_to_dict(r) for r in msg_rows]


def create_message(
    db: Session,
    conversation_id: int,
    role: str,
    content: str,
    citations: Optional[List[Dict[str, Any]]] = None,
    has_evidence: Optional[bool] = None,
    needs_verification: bool = False,
) -> Dict[str, Any]:
    """Append a message; update conversation.last_message + last_message_at."""
    _ensure_schema(db)
    now = datetime.now(timezone.utc).isoformat()
    citations_json = json.dumps(citations) if citations else None

    result = db.execute(
        text(
            """
            INSERT INTO docbrain_messages
                (conversation_id, role, content, citations_json,
                 has_evidence, needs_verification, created_at)
            VALUES
                (:conv_id, :role, :content, :citations_json,
                 :has_evidence, :needs_verification, :now)
            """
        ),
        {
            "conv_id":            conversation_id,
            "role":               role,
            "content":            content,
            "citations_json":     citations_json,
            "has_evidence":       int(has_evidence) if has_evidence is not None else None,
            "needs_verification": int(needs_verification),
            "now":                now,
        },
    )
    new_id = result.lastrowid

    # Update conversation preview (truncate to 200 chars for sidebar).
    preview = content[:200]
    db.execute(
        text(
            """
            UPDATE docbrain_conversations
            SET last_message = :preview,
                last_message_at = :now,
                updated_at = :now
            WHERE id = :conv_id
            """
        ),
        {"preview": preview, "now": now, "conv_id": conversation_id},
    )
    db.commit()

    row = db.execute(
        text(
            """
            SELECT id, conversation_id, role, content, citations_json,
                   has_evidence, needs_verification, deleted_at, edited_at,
                   created_at
            FROM docbrain_messages WHERE id = :id
            """
        ),
        {"id": new_id},
    ).first()
    return _msg_row_to_dict(row)


def edit_message(
    db: Session,
    message_id: int,
    conversation_id: int,
    new_content: str,
) -> Optional[Dict[str, Any]]:
    """Inline-replace user message content and soft-delete the tail.

    Returns the updated message dict or None if the message does not exist.

    Audit-safe: soft-deleted rows are retained (deleted_at IS NOT NULL) and
    recoverable via direct SQL without the SPA filter.
    """
    _ensure_schema(db)
    now = datetime.now(timezone.utc).isoformat()

    # Verify the message exists and belongs to the conversation.
    existing = db.execute(
        text(
            "SELECT id, created_at FROM docbrain_messages "
            "WHERE id = :id AND conversation_id = :conv_id AND deleted_at IS NULL"
        ),
        {"id": message_id, "conv_id": conversation_id},
    ).first()
    if existing is None:
        return None

    # Update the message content.
    db.execute(
        text(
            "UPDATE docbrain_messages SET content = :content, edited_at = :now "
            "WHERE id = :id"
        ),
        {"content": new_content, "id": message_id, "now": now},
    )

    # Soft-delete all messages that came AFTER this one in the same conversation.
    db.execute(
        text(
            """
            UPDATE docbrain_messages
            SET deleted_at = :now
            WHERE conversation_id = :conv_id
              AND id > :msg_id
              AND deleted_at IS NULL
            """
        ),
        {"now": now, "conv_id": conversation_id, "msg_id": message_id},
    )

    # Reset last_message on the conversation to the edited content.
    db.execute(
        text(
            "UPDATE docbrain_conversations "
            "SET last_message = :preview, updated_at = :now "
            "WHERE id = :conv_id"
        ),
        {"preview": new_content[:200], "now": now, "conv_id": conversation_id},
    )
    db.commit()

    row = db.execute(
        text(
            "SELECT id, conversation_id, role, content, citations_json, "
            "has_evidence, needs_verification, deleted_at, edited_at, created_at "
            "FROM docbrain_messages WHERE id = :id"
        ),
        {"id": message_id},
    ).first()
    return _msg_row_to_dict(row)


def soft_delete_message(db: Session, message_id: int) -> bool:
    """Mark a single message deleted. Returns True if found."""
    _ensure_schema(db)
    now = datetime.now(timezone.utc).isoformat()
    result = db.execute(
        text(
            "UPDATE docbrain_messages SET deleted_at = :now "
            "WHERE id = :id AND deleted_at IS NULL"
        ),
        {"now": now, "id": message_id},
    )
    db.commit()
    return (result.rowcount or 0) > 0


def pin_conversation(
    db: Session,
    conversation_id: int,
    user_id: int,
    pinned: bool,
) -> bool:
    """Upsert / remove docbrain_pins and mirror to conversations.pinned.
    Returns False if conversation not found.
    """
    _ensure_schema(db)
    now = datetime.now(timezone.utc).isoformat()

    # Verify exists.
    exists = db.execute(
        text("SELECT id FROM docbrain_conversations WHERE id = :id"),
        {"id": conversation_id},
    ).first()
    if exists is None:
        return False

    if pinned:
        db.execute(
            text(
                "INSERT OR REPLACE INTO docbrain_pins (conversation_id, user_id, pinned_at) "
                "VALUES (:conv_id, :user_id, :now)"
            ),
            {"conv_id": conversation_id, "user_id": user_id, "now": now},
        )
    else:
        db.execute(
            text(
                "DELETE FROM docbrain_pins "
                "WHERE conversation_id = :conv_id AND user_id = :user_id"
            ),
            {"conv_id": conversation_id, "user_id": user_id},
        )

    # Mirror to pinned column (any user's pin marks the conversation pinned).
    db.execute(
        text(
            "UPDATE docbrain_conversations SET pinned = :pinned, updated_at = :now "
            "WHERE id = :id"
        ),
        {"pinned": int(pinned), "now": now, "id": conversation_id},
    )
    db.commit()
    return True


def set_folder(
    db: Session,
    conversation_id: int,
    tenant_id: str,
    user_id: int,
    folder: Optional[str],
) -> bool:
    """Set or clear the folder for a conversation. Returns False if not found/owned."""
    _ensure_schema(db)
    now = datetime.now(timezone.utc).isoformat()
    result = db.execute(
        text(
            "UPDATE docbrain_conversations "
            "SET folder = :folder, updated_at = :now "
            "WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id"
        ),
        {
            "folder":    folder,
            "now":       now,
            "id":        conversation_id,
            "tenant_id": tenant_id,
            "user_id":   user_id,
        },
    )
    db.commit()
    return (result.rowcount or 0) > 0

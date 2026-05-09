"""DocBrain Chat v2 — conversation persistence, FTS5, pins.

Wave C — DocBrain Chat v2 scope:

  Tables created:
    docbrain_conversations  — one row per conversation thread (persona, folder,
                              pin flag, model_used, last_message_at).
    docbrain_messages       — one row per message turn (role, content,
                              citations_json, has_evidence, deleted_at).
    docbrain_pins           — per-user shared pins (composite PK).
    docbrain_conv_fts       — FTS5 virtual table over title + last_message +
                              persona; synced via three triggers.

  Soft-deleted rows retained for audit; SPA filters by default.

  deleted_at defaults to NULL so no existing rows are accidentally marked
  deleted on migration — only explicit PATCH/regenerate writes set it.

Revision ID  : 0041_docbrain_conversations
Revises      : 0037_users_v2
Create Date  : 2026-05-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0041_docbrain_conversations"
down_revision = "0040_dsar_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. docbrain_conversations
    # ------------------------------------------------------------------
    op.create_table(
        "docbrain_conversations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, server_default="nbe"),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("title", sa.String(300), nullable=False, server_default="New chat"),
        sa.Column("persona", sa.String(64), nullable=True),
        sa.Column("folder", sa.String(128), nullable=True),
        sa.Column("pinned", sa.Boolean, nullable=False, server_default="0"),
        sa.Column("model_used", sa.String(128), nullable=True),
        # last_message holds a short preview for sidebar + FTS indexing.
        sa.Column("last_message", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("last_message_at", sa.DateTime, nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.tenant_id"]),
    )
    op.create_index(
        "idx_dc_tenant_user",
        "docbrain_conversations",
        ["tenant_id", "user_id"],
    )
    op.create_index(
        "idx_dc_last_message_at",
        "docbrain_conversations",
        ["last_message_at"],
    )

    # ------------------------------------------------------------------
    # 2. docbrain_messages
    # ------------------------------------------------------------------
    op.create_table(
        "docbrain_messages",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("conversation_id", sa.Integer, nullable=False),
        sa.Column(
            "role",
            sa.String(16),
            nullable=False,
        ),
        sa.Column("content", sa.Text, nullable=False, server_default=""),
        # JSON array of {document_id, chunk_index, snippet} citation objects.
        sa.Column("citations_json", sa.Text, nullable=True),
        sa.Column("has_evidence", sa.Boolean, nullable=True),
        sa.Column("needs_verification", sa.Boolean, nullable=True, server_default="0"),
        # deleted_at is NULL by default — soft-deleted rows retained for audit.
        # The SPA filters WHERE deleted_at IS NULL. Audit queries omit the filter.
        sa.Column("deleted_at", sa.DateTime, nullable=True),
        # edited_at is set when a user message is edited inline.
        sa.Column("edited_at", sa.DateTime, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.CheckConstraint(
            "role IN ('user', 'assistant')",
            name="ck_docbrain_messages_role",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["docbrain_conversations.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "idx_dm_conv_created",
        "docbrain_messages",
        ["conversation_id", "created_at"],
    )

    # ------------------------------------------------------------------
    # 3. docbrain_pins
    # ------------------------------------------------------------------
    op.create_table(
        "docbrain_pins",
        sa.Column("conversation_id", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column(
            "pinned_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.PrimaryKeyConstraint("conversation_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["docbrain_conversations.id"],
            ondelete="CASCADE",
        ),
    )

    # ------------------------------------------------------------------
    # 4. FTS5 virtual table + sync triggers
    #    SQLite FTS5 + triggers cannot go through Alembic DDL helpers;
    #    we use op.execute with raw SQL.
    # ------------------------------------------------------------------
    op.execute(sa.text(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS docbrain_conv_fts
        USING fts5(
            title,
            last_message,
            persona,
            content='docbrain_conversations',
            content_rowid='id'
        )
        """
    ))

    # AFTER INSERT — populate FTS when a new conversation is created.
    op.execute(sa.text(
        """
        CREATE TRIGGER IF NOT EXISTS docbrain_conv_ai
        AFTER INSERT ON docbrain_conversations BEGIN
            INSERT INTO docbrain_conv_fts(rowid, title, last_message, persona)
            VALUES (NEW.id, NEW.title, COALESCE(NEW.last_message,''), COALESCE(NEW.persona,''));
        END
        """
    ))

    # AFTER UPDATE — keep FTS in sync when title / last_message / persona change.
    op.execute(sa.text(
        """
        CREATE TRIGGER IF NOT EXISTS docbrain_conv_au
        AFTER UPDATE ON docbrain_conversations BEGIN
            INSERT INTO docbrain_conv_fts(docbrain_conv_fts, rowid, title, last_message, persona)
            VALUES ('delete', OLD.id, OLD.title, COALESCE(OLD.last_message,''), COALESCE(OLD.persona,''));
            INSERT INTO docbrain_conv_fts(rowid, title, last_message, persona)
            VALUES (NEW.id, NEW.title, COALESCE(NEW.last_message,''), COALESCE(NEW.persona,''));
        END
        """
    ))

    # AFTER DELETE — remove from FTS when conversation is hard-deleted.
    op.execute(sa.text(
        """
        CREATE TRIGGER IF NOT EXISTS docbrain_conv_ad
        AFTER DELETE ON docbrain_conversations BEGIN
            INSERT INTO docbrain_conv_fts(docbrain_conv_fts, rowid, title, last_message, persona)
            VALUES ('delete', OLD.id, OLD.title, COALESCE(OLD.last_message,''), COALESCE(OLD.persona,''));
        END
        """
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TRIGGER IF EXISTS docbrain_conv_ad"))
    op.execute(sa.text("DROP TRIGGER IF EXISTS docbrain_conv_au"))
    op.execute(sa.text("DROP TRIGGER IF EXISTS docbrain_conv_ai"))
    op.execute(sa.text("DROP TABLE IF EXISTS docbrain_conv_fts"))
    op.drop_table("docbrain_pins")
    op.drop_table("docbrain_messages")
    op.drop_table("docbrain_conversations")

"""Add document-redaction tables and columns (BHU-46).

Changes:
  - documents: add parent_id (self-FK), redacted (INTEGER DEFAULT 0), version (INTEGER DEFAULT 1)
  - redaction_log: new table with tenant_id, document_id, redacted_version_id, redacted_by,
                   regions (JSON), reason, created_at, plus four indexes.

All changes are additive. No existing data is modified. Rollback removes the
new columns and table safely.

Revision ID : 0024_redaction
Revises     : 0023_worm_retention
Create Date : 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0024_redaction"
down_revision = "0023_worm_retention"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # documents: new columns for version chain + redaction flag
    # ------------------------------------------------------------------
    with op.batch_alter_table("documents") as batch_op:
        batch_op.add_column(
            sa.Column("parent_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("redacted", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("version", sa.Integer(), nullable=False, server_default="1")
        )
        # SQLite does not enforce FK by default; in Postgres this FK is
        # enforced. We add the FK constraint via create_foreign_key so that
        # the Alembic model reflects the intent even if SQLite ignores it.
        batch_op.create_foreign_key(
            "fk_documents_parent_id",
            "documents",
            ["parent_id"],
            ["id"],
        )

    op.create_index("idx_documents_parent_id", "documents", ["parent_id"])
    op.create_index("idx_documents_redacted", "documents", ["redacted"])

    # ------------------------------------------------------------------
    # redaction_log: new audit table
    # ------------------------------------------------------------------
    op.create_table(
        "redaction_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("documents.id"),
            nullable=False,
        ),
        sa.Column(
            "redacted_version_id",
            sa.Integer(),
            sa.ForeignKey("documents.id"),
            nullable=False,
        ),
        sa.Column("redacted_by", sa.String(256), nullable=False),
        sa.Column("regions", sa.JSON(), nullable=False),
        sa.Column("reason", sa.String(128), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("tenant_id", sa.String(64), nullable=False, server_default="default"),
    )

    op.create_index("idx_rl_document_id", "redaction_log", ["document_id"])
    op.create_index("idx_rl_version_id", "redaction_log", ["redacted_version_id"])
    op.create_index("idx_rl_created_at", "redaction_log", ["created_at"])
    op.create_index("idx_rl_tenant_id", "redaction_log", ["tenant_id"])


def downgrade() -> None:
    # Drop redaction_log and its indexes
    op.drop_index("idx_rl_tenant_id", table_name="redaction_log")
    op.drop_index("idx_rl_created_at", table_name="redaction_log")
    op.drop_index("idx_rl_version_id", table_name="redaction_log")
    op.drop_index("idx_rl_document_id", table_name="redaction_log")
    op.drop_table("redaction_log")

    # Drop indexes on documents
    op.drop_index("idx_documents_redacted", table_name="documents")
    op.drop_index("idx_documents_parent_id", table_name="documents")

    # Drop added columns from documents
    with op.batch_alter_table("documents") as batch_op:
        batch_op.drop_constraint("fk_documents_parent_id", type_="foreignkey")
        batch_op.drop_column("version")
        batch_op.drop_column("redacted")
        batch_op.drop_column("parent_id")

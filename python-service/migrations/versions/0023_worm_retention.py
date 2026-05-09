"""Add WORM retention lock columns to documents table.

Four new nullable columns support filesystem-level Write-Once-Read-Many (WORM)
immutability for documents under retention (BHU-32):

  worm_locked_at    — UTC timestamp when the document was locked; NULL = unlocked.
  worm_unlock_after — UTC timestamp after which the lock may be removed.
  worm_release_reason — free-text reason recorded when lock is lifted.
  sha256_at_lock    — SHA-256 hex digest captured at lock time; used by nightly
                      verification to detect tampering.

Two indexes support efficient nightly verification queries:

  idx_documents_worm_locked_at    — for SELECT WHERE worm_locked_at IS NOT NULL
  idx_documents_worm_unlock_after — for SELECT WHERE worm_unlock_after <= now

All changes are strictly additive.  No existing column is altered.
Existing documents remain unlocked (all four columns = NULL) after migration.

Revision ID  : 0023_worm_retention
Revises      : 0022_cbs_document_links
Create Date  : 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0023_worm_retention"
down_revision = "0022_cbs_document_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch_op:
        batch_op.add_column(
            sa.Column("worm_locked_at", sa.DateTime, nullable=True)
        )
        batch_op.add_column(
            sa.Column("worm_unlock_after", sa.DateTime, nullable=True)
        )
        batch_op.add_column(
            sa.Column("worm_release_reason", sa.String(128), nullable=True)
        )
        batch_op.add_column(
            sa.Column("sha256_at_lock", sa.String(64), nullable=True)
        )

    op.create_index(
        "idx_documents_worm_locked_at",
        "documents",
        ["worm_locked_at"],
    )
    op.create_index(
        "idx_documents_worm_unlock_after",
        "documents",
        ["worm_unlock_after"],
    )


def downgrade() -> None:
    op.drop_index("idx_documents_worm_unlock_after", table_name="documents")
    op.drop_index("idx_documents_worm_locked_at", table_name="documents")

    with op.batch_alter_table("documents") as batch_op:
        batch_op.drop_column("sha256_at_lock")
        batch_op.drop_column("worm_release_reason")
        batch_op.drop_column("worm_unlock_after")
        batch_op.drop_column("worm_locked_at")

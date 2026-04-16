"""retention policies + legal holds

Revision ID: 0006_retention
Revises: 0005_portal
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_retention"
down_revision = "0005_portal"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "retention_policies",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("doc_type", sa.String(64), unique=True, index=True),
        sa.Column("retention_days", sa.Integer),
        sa.Column("action", sa.String(16), server_default="purge"),
        sa.Column("tenant", sa.String(64), server_default="default"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "legal_holds",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("document_id", sa.Integer, sa.ForeignKey("documents.id", ondelete="CASCADE"), index=True),
        sa.Column("reason", sa.String(512)),
        sa.Column("case_ref", sa.String(128)),
        sa.Column("placed_by", sa.String(128)),
        sa.Column("placed_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("released_by", sa.String(128)),
        sa.Column("released_at", sa.DateTime),
    )


def downgrade() -> None:
    op.drop_table("legal_holds")
    op.drop_table("retention_policies")

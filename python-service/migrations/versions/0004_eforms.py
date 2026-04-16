"""add eforms tables

Revision ID: 0004_eforms
Revises: 0003_tenant_column
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_eforms"
down_revision = "0003_tenant_column"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "eforms",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("key", sa.String(64), unique=True, index=True),
        sa.Column("title", sa.String(256)),
        sa.Column("version", sa.Integer, server_default="1"),
        sa.Column("tenant", sa.String(64), server_default="default", index=True),
        sa.Column("schema_json", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "eform_submissions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("form_id", sa.Integer, sa.ForeignKey("eforms.id", ondelete="CASCADE")),
        sa.Column("customer_cid", sa.String(64), index=True),
        sa.Column("document_id", sa.Integer, sa.ForeignKey("documents.id")),
        sa.Column("submitted_by", sa.String(128)),
        sa.Column("data_json", sa.Text),
        sa.Column("status", sa.String(32), server_default="submitted"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("eform_submissions")
    op.drop_table("eforms")

"""add tenant column to documents

Revision ID: 0003_tenant_column
Revises: 0002_task_runs
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_tenant_column"
down_revision = "0002_task_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("tenant", sa.String(64), server_default="default"))
        batch.create_index("ix_documents_tenant", ["tenant"])
        batch.create_index("ix_documents_branch", ["branch"])


def downgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.drop_index("ix_documents_branch")
        batch.drop_index("ix_documents_tenant")
        batch.drop_column("tenant")

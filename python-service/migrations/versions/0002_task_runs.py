"""add task_runs table

Revision ID: 0002_task_runs
Revises: 0001_initial
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_task_runs"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(64)),
        sa.Column("status", sa.String(16), server_default="queued"),
        sa.Column("payload_json", sa.Text),
        sa.Column("result_json", sa.Text),
        sa.Column("error", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime),
    )


def downgrade() -> None:
    op.drop_table("task_runs")

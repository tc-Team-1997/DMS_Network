"""usage_events table

Revision ID: 0013_usage
Revises: 0012_e2ee_voice_zk
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_usage"
down_revision = "0012_e2ee_voice_zk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usage_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("feature", sa.String(64), index=True),
        sa.Column("user_sub", sa.String(128), index=True),
        sa.Column("tenant", sa.String(64), index=True),
        sa.Column("branch", sa.String(128)),
        sa.Column("path", sa.String(256)),
        sa.Column("status_code", sa.Integer),
        sa.Column("latency_ms", sa.Integer),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    op.drop_table("usage_events")

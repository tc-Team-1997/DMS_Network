"""add sync_clock for active-active replication

Revision ID: 0009_sync_clock
Revises: 0008_fx
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_sync_clock"
down_revision = "0008_fx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("sync_clock", sa.Text))


def downgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.drop_column("sync_clock")

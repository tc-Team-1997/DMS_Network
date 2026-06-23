"""review_items table

Revision ID: 0001_review_queue
Revises:
Create Date: 2026-06-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_review_queue"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("doc_id", sa.String(64), index=True),
        sa.Column("doc_type", sa.String(40)),
        sa.Column("confidence", sa.Float()),
        sa.Column("band", sa.String(20)),
        sa.Column("sla_hours", sa.Integer(), nullable=True),
        sa.Column("sla_deadline", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(20), index=True),
        sa.Column("claimed_by", sa.String(100), nullable=True),
        sa.Column("resolution", sa.String(40), nullable=True),
        sa.Column("payload_json", sa.Text()),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("review_items")

"""customer portal sessions

Revision ID: 0005_portal
Revises: 0004_eforms
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_portal"
down_revision = "0004_eforms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_sessions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_cid", sa.String(64), index=True),
        sa.Column("email", sa.String(256), index=True),
        sa.Column("otp_code", sa.String(8)),
        sa.Column("otp_expires_at", sa.DateTime),
        sa.Column("token", sa.String(64), index=True),
        sa.Column("verified_at", sa.DateTime),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("portal_sessions")

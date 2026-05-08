"""Add user_notification_preferences and alert_records tables (BRD #24 multi-channel alerts).

Revision ID: 0017_user_notification_preferences
Revises: 0016_stamps_compliance
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0017_user_notification_preferences"
down_revision = "0016_stamps_compliance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_notification_preferences",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_sub", sa.String(128), nullable=False, unique=True, index=True),
        # JSON array as TEXT: '["email","sms","whatsapp"]'. NULL → default ["email"].
        sa.Column("notification_channels", sa.Text, nullable=True),
        sa.Column("email", sa.String(256), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "alert_records",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_sub", sa.String(128), nullable=False, index=True),
        sa.Column("level", sa.String(16), server_default="info", index=True),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("message", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    op.drop_table("alert_records")
    op.drop_table("user_notification_preferences")

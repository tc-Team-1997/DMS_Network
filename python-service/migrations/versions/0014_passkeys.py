"""passkey_credentials table

Revision ID: 0014_passkeys
Revises: 0013_usage
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_passkeys"
down_revision = "0013_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "passkey_credentials",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_cid", sa.String(64), index=True),
        sa.Column("user_handle", sa.String(128), index=True),
        sa.Column("credential_id", sa.Text),
        sa.Column("public_key", sa.Text),
        sa.Column("sign_count", sa.Integer, server_default="0"),
        sa.Column("aaguid", sa.String(64)),
        sa.Column("friendly_name", sa.String(128)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime),
    )


def downgrade() -> None:
    op.drop_table("passkey_credentials")

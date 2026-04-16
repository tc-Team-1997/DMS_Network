"""webauthn credentials + stepup challenges

Revision ID: 0007_webauthn
Revises: 0006_retention
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_webauthn"
down_revision = "0006_retention"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_sub", sa.String(128), index=True),
        sa.Column("credential_id", sa.Text),
        sa.Column("public_key", sa.Text),
        sa.Column("sign_count", sa.Integer, server_default="0"),
        sa.Column("transports", sa.String(64)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime),
    )
    op.create_table(
        "stepup_challenges",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_sub", sa.String(128), index=True),
        sa.Column("action", sa.String(64)),
        sa.Column("resource_id", sa.Integer),
        sa.Column("challenge", sa.String(256)),
        sa.Column("kind", sa.String(16), server_default="register"),
        sa.Column("used", sa.Integer, server_default="0"),
        sa.Column("expires_at", sa.DateTime),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("stepup_challenges")
    op.drop_table("webauthn_credentials")

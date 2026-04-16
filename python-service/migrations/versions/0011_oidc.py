"""oidc provider tables

Revision ID: 0011_oidc
Revises: 0010_provenance_ais
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_oidc"
down_revision = "0010_provenance_ais"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oidc_clients",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.String(64), unique=True, index=True),
        sa.Column("client_secret", sa.String(128)),
        sa.Column("name", sa.String(128)),
        sa.Column("redirect_uris", sa.Text),
        sa.Column("scopes", sa.String(256), server_default="openid profile email"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "oidc_auth_codes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(128), unique=True, index=True),
        sa.Column("client_id", sa.String(64), index=True),
        sa.Column("user_sub", sa.String(128)),
        sa.Column("tenant", sa.String(64)),
        sa.Column("scope", sa.String(256)),
        sa.Column("redirect_uri", sa.String(512)),
        sa.Column("nonce", sa.String(128)),
        sa.Column("expires_at", sa.DateTime),
        sa.Column("used", sa.Integer, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("oidc_auth_codes")
    op.drop_table("oidc_clients")

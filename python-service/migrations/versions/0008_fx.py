"""fx rates table

Revision ID: 0008_fx
Revises: 0007_webauthn
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_fx"
down_revision = "0007_webauthn"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fx_rates",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("base", sa.String(3), index=True),
        sa.Column("quote", sa.String(3), index=True),
        sa.Column("rate", sa.Float),
        sa.Column("as_of", sa.DateTime, server_default=sa.func.now(), index=True),
        sa.Column("source", sa.String(64), server_default="manual"),
    )


def downgrade() -> None:
    op.drop_table("fx_rates")

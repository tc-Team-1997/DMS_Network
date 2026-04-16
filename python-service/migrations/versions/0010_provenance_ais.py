"""provenance events + open-banking AIS tables

Revision ID: 0010_provenance_ais
Revises: 0009_sync_clock
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_provenance_ais"
down_revision = "0009_sync_clock"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provenance_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("document_id", sa.Integer, sa.ForeignKey("documents.id", ondelete="CASCADE"), index=True),
        sa.Column("kind", sa.String(32), index=True),
        sa.Column("system", sa.String(64)),
        sa.Column("actor", sa.String(128)),
        sa.Column("region", sa.String(32)),
        sa.Column("parent_event_id", sa.Integer, sa.ForeignKey("provenance_events.id")),
        sa.Column("payload_json", sa.Text),
        sa.Column("hash_prev", sa.String(64)),
        sa.Column("hash_self", sa.String(64)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), index=True),
    )
    op.create_table(
        "ais_consents",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_cid", sa.String(64), index=True),
        sa.Column("provider", sa.String(64)),
        sa.Column("consent_id", sa.String(128)),
        sa.Column("scopes", sa.String(256)),
        sa.Column("status", sa.String(16), server_default="pending"),
        sa.Column("token", sa.Text),
        sa.Column("refresh_token", sa.Text),
        sa.Column("expires_at", sa.DateTime),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "ais_statements",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("consent_id", sa.Integer, sa.ForeignKey("ais_consents.id", ondelete="CASCADE")),
        sa.Column("account_id", sa.String(64)),
        sa.Column("as_of", sa.DateTime),
        sa.Column("currency", sa.String(3)),
        sa.Column("balance", sa.Float),
        sa.Column("transactions_json", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("ais_statements")
    op.drop_table("ais_consents")
    op.drop_table("provenance_events")

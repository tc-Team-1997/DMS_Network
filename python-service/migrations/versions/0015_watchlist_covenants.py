"""watchlist + loan covenants

Revision ID: 0015_watchlist_covenants
Revises: 0014_passkeys
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_watchlist_covenants"
down_revision = "0014_passkeys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watchlist_entries",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source", sa.String(16), index=True),
        sa.Column("ext_id", sa.String(128), index=True),
        sa.Column("name", sa.String(512), index=True),
        sa.Column("name_norm", sa.String(512), index=True),
        sa.Column("aliases_json", sa.Text),
        sa.Column("dob", sa.String(32)),
        sa.Column("country", sa.String(8)),
        sa.Column("category", sa.String(64)),
        sa.Column("listed_at", sa.DateTime),
        sa.Column("raw_json", sa.Text),
        sa.Column("loaded_at", sa.DateTime, server_default=sa.func.now(), index=True),
    )
    op.create_table(
        "watchlist_matches",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_cid", sa.String(64), index=True),
        sa.Column("document_id", sa.Integer, sa.ForeignKey("documents.id"), index=True),
        sa.Column("entry_id", sa.Integer, sa.ForeignKey("watchlist_entries.id")),
        sa.Column("score", sa.Float),
        sa.Column("matched_name", sa.String(512)),
        sa.Column("reason", sa.String(256)),
        sa.Column("status", sa.String(16), server_default="open"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("reviewed_by", sa.String(128)),
        sa.Column("reviewed_at", sa.DateTime),
    )
    op.create_table(
        "loan_covenants",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("document_id", sa.Integer, sa.ForeignKey("documents.id", ondelete="CASCADE"), index=True),
        sa.Column("kind", sa.String(32)),
        sa.Column("clause", sa.Text),
        sa.Column("metric", sa.String(64)),
        sa.Column("operator", sa.String(8)),
        sa.Column("threshold", sa.Float),
        sa.Column("currency", sa.String(3)),
        sa.Column("confidence", sa.Float),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("loan_covenants")
    op.drop_table("watchlist_matches")
    op.drop_table("watchlist_entries")

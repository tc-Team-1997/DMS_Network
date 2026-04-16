"""stamp fingerprints + compliance scores + workflow designs

Revision ID: 0016_stamps_compliance
Revises: 0015_watchlist_covenants
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0016_stamps_compliance"
down_revision = "0015_watchlist_covenants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stamp_fingerprints",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("document_id", sa.Integer, sa.ForeignKey("documents.id", ondelete="CASCADE"), index=True),
        sa.Column("phash", sa.String(32), index=True),
        sa.Column("avg_color", sa.String(16)),
        sa.Column("bbox", sa.String(64)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "compliance_scores",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant", sa.String(64), index=True),
        sa.Column("framework", sa.String(32), index=True),
        sa.Column("control_id", sa.String(64)),
        sa.Column("status", sa.String(16)),
        sa.Column("evidence", sa.Text),
        sa.Column("score", sa.Float),
        sa.Column("measured_at", sa.DateTime, server_default=sa.func.now(), index=True),
    )
    op.create_table(
        "workflow_designs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant", sa.String(64), index=True),
        sa.Column("name", sa.String(128)),
        sa.Column("description", sa.Text),
        sa.Column("spec_json", sa.Text),
        sa.Column("created_by", sa.String(128)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("workflow_designs")
    op.drop_table("compliance_scores")
    op.drop_table("stamp_fingerprints")

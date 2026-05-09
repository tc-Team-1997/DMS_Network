"""Provision AML screening tables (BHU-67 Phase 2).

Four new tables for the AML watchlist screening pipeline:

  aml_watchlists        — list metadata (OFAC SDN, EU Consolidated, UN SC, …)
  aml_watchlist_entries — flat record set for each list
  aml_screenings        — one row per screening run per customer
  aml_hits              — one row per matched watchlist entry per screening

All columns are additive (new tables); no existing table is modified.
Tenant boundary is enforced on aml_watchlists and aml_screenings; entries
and hits inherit tenant via FK.

No FTS5 / full-text indexes — matching is Levenshtein-based, not SQL FTS.

Revision ID : 0021_aml_screening
Revises     : 0020_ocr_confidence_thresholds
Create Date : 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0021_aml_screening"
down_revision = "0020_ocr_confidence_thresholds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # aml_watchlists
    # ------------------------------------------------------------------
    op.create_table(
        "aml_watchlists",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("list_name", sa.String(256), nullable=False),
        sa.Column("source_url", sa.String(512), nullable=True),
        sa.Column("match_threshold", sa.Float, nullable=False, server_default="0.85"),
        sa.Column("last_updated", sa.DateTime, nullable=True),
        sa.Column("entry_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("active", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("tenant_id", "list_name", name="uq_aml_watchlist_tenant_name"),
    )
    op.create_index(
        "idx_aml_watchlists_tenant",
        "aml_watchlists",
        ["tenant_id"],
    )

    # ------------------------------------------------------------------
    # aml_watchlist_entries
    # ------------------------------------------------------------------
    op.create_table(
        "aml_watchlist_entries",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "watchlist_id",
            sa.Integer,
            sa.ForeignKey("aml_watchlists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("normalized_name", sa.String(512), nullable=False),
        sa.Column("dob", sa.String(10), nullable=True),
        sa.Column("country", sa.String(3), nullable=True),
        sa.Column("original_record", sa.JSON, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "idx_aml_entries_wl",
        "aml_watchlist_entries",
        ["watchlist_id"],
    )
    op.create_index(
        "idx_aml_entries_name",
        "aml_watchlist_entries",
        ["normalized_name"],
    )

    # ------------------------------------------------------------------
    # aml_screenings
    # ------------------------------------------------------------------
    op.create_table(
        "aml_screenings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("customer_cid", sa.String(64), nullable=False),
        sa.Column(
            "screened_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("hit_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("trigger_reason", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime, nullable=True),
        sa.Column("completed_at", sa.DateTime, nullable=True),
    )
    op.create_index(
        "idx_aml_screenings_tenant",
        "aml_screenings",
        ["tenant_id"],
    )
    op.create_index(
        "idx_aml_screenings_cid",
        "aml_screenings",
        ["tenant_id", "customer_cid"],
    )
    op.create_index(
        "idx_aml_screenings_at",
        "aml_screenings",
        ["screened_at"],
    )

    # ------------------------------------------------------------------
    # aml_hits
    # ------------------------------------------------------------------
    op.create_table(
        "aml_hits",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "screening_id",
            sa.Integer,
            sa.ForeignKey("aml_screenings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "watchlist_entry_id",
            sa.Integer,
            sa.ForeignKey("aml_watchlist_entries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("score", sa.Float, nullable=False),
        sa.Column("decision", sa.String(32), nullable=False, server_default="open"),
        sa.Column("reviewed_by", sa.Integer, nullable=True),
        sa.Column("reviewed_at", sa.DateTime, nullable=True),
        sa.Column("review_notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "idx_aml_hits_screening",
        "aml_hits",
        ["screening_id"],
    )
    op.create_index(
        "idx_aml_hits_decision",
        "aml_hits",
        ["decision"],
    )


def downgrade() -> None:
    # Drop in reverse FK dependency order.
    op.drop_index("idx_aml_hits_decision", table_name="aml_hits")
    op.drop_index("idx_aml_hits_screening", table_name="aml_hits")
    op.drop_table("aml_hits")

    op.drop_index("idx_aml_screenings_at", table_name="aml_screenings")
    op.drop_index("idx_aml_screenings_cid", table_name="aml_screenings")
    op.drop_index("idx_aml_screenings_tenant", table_name="aml_screenings")
    op.drop_table("aml_screenings")

    op.drop_index("idx_aml_entries_name", table_name="aml_watchlist_entries")
    op.drop_index("idx_aml_entries_wl", table_name="aml_watchlist_entries")
    op.drop_table("aml_watchlist_entries")

    op.drop_index("idx_aml_watchlists_tenant", table_name="aml_watchlists")
    op.drop_table("aml_watchlists")

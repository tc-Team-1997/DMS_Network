"""Migration 0035 — AML hit suppressions + Customer PII reveal audit tables.

New tables:
  1. aml_hit_suppressions — false-positive memory for AML hit-decide v2.
     When a compliance officer clears a subject×entry pair with suppression,
     future screenings of the same pair are auto-cleared with the prior reason
     until suppressed_until expires.

  2. customer_pii_reveals — audit trail for every PII field reveal in the
     Customer-360 drawer. Each reveal is atomic (one row per reveal event,
     per field set) and is retained indefinitely for regulatory audit.

Revision ID  : 0035_aml_360
Revises      : 0031_doctype_versions
Create Date  : 2026-05-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0035_aml_360"
down_revision = "0031_doctype_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. aml_hit_suppressions ──────────────────────────────────────────────
    op.create_table(
        "aml_hit_suppressions",
        sa.Column("id",                 sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column("tenant_id",          sa.String(64),    nullable=False),
        sa.Column("subject_cid",        sa.String(64),    nullable=False),
        sa.Column("watchlist_entry_id", sa.Integer(),     nullable=False),
        sa.Column("suppression_reason", sa.Text(),        nullable=False),
        sa.Column("suppressed_until",   sa.DateTime(),    nullable=True),
        sa.Column("suppressed_by",      sa.String(256),   nullable=False),
        sa.Column("created_at",         sa.DateTime(),    nullable=False,
                  server_default=sa.text("(datetime('now'))")),
    )
    op.create_index(
        "ix_aml_hit_suppressions_tenant_cid",
        "aml_hit_suppressions",
        ["tenant_id", "subject_cid"],
    )
    op.create_index(
        "ix_aml_hit_suppressions_entry",
        "aml_hit_suppressions",
        ["watchlist_entry_id"],
    )
    op.create_index(
        "ix_aml_hit_suppressions_cid_entry",
        "aml_hit_suppressions",
        ["tenant_id", "subject_cid", "watchlist_entry_id"],
    )

    # ── 2. customer_pii_reveals ──────────────────────────────────────────────
    op.create_table(
        "customer_pii_reveals",
        sa.Column("id",           sa.Integer(),   primary_key=True, autoincrement=True),
        sa.Column("tenant_id",    sa.String(64),  nullable=False),
        sa.Column("user_id",      sa.Integer(),   nullable=False),
        sa.Column("customer_cid", sa.String(64),  nullable=False),
        sa.Column("fields_json",  sa.Text(),      nullable=False),  # JSON array of field names
        sa.Column("reason",       sa.Text(),      nullable=False),
        sa.Column("created_at",   sa.DateTime(),  nullable=False,
                  server_default=sa.text("(datetime('now'))")),
    )
    op.create_index(
        "ix_customer_pii_reveals_tenant_cid",
        "customer_pii_reveals",
        ["tenant_id", "customer_cid"],
    )
    op.create_index(
        "ix_customer_pii_reveals_user",
        "customer_pii_reveals",
        ["tenant_id", "user_id"],
    )
    op.create_index(
        "ix_customer_pii_reveals_created",
        "customer_pii_reveals",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_table("customer_pii_reveals")
    op.drop_table("aml_hit_suppressions")

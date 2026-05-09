"""Provision CBS Temenos T24 linkage and circuit-breaker tables.

Two new append-only tables for the Temenos CBS adapter (BHU-48, BHU-52):

  cbs_document_links  — durable audit record of every successful T24 linkage;
                        idempotency enforced at DB layer via UNIQUE(tenant_id,
                        idempotency_key) so duplicate calls cannot insert twice.

  cbs_circuit_events  — append-only event log for circuit-breaker state
                        transitions; used by ops dashboards and Grafana panel
                        "CBS Integration".

All columns are additive (new tables only).  No existing table is modified.
Tenant boundary enforced on both tables (tenant_id NOT NULL on every row).

No FTS5 / full-text index — link records are not full-text searchable.

Revision ID : 0022_cbs_document_links
Revises     : 0021_aml_screening
Create Date : 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0022_cbs_document_links"
down_revision = "0021_aml_screening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # cbs_document_links
    # ------------------------------------------------------------------
    op.create_table(
        "cbs_document_links",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("cif", sa.String(64), nullable=False),
        sa.Column(
            "document_id",
            sa.Integer,
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("transaction_ref", sa.String(256), nullable=False),
        sa.Column("transaction_type", sa.String(64), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column(
            "linked_by",
            sa.Integer,
            # users table exists in Node SQLite; in Postgres the FK target
            # depends on the auth model deployed.  We reference it loosely
            # so the migration works against both SQLite (no FK enforcement
            # by default) and Postgres (FK enforced).
            nullable=False,
        ),
        sa.Column(
            "linked_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint(
            "tenant_id", "idempotency_key",
            name="uq_cbs_link_tenant_idem",
        ),
    )
    op.create_index(
        "idx_cbs_links_tenant",
        "cbs_document_links",
        ["tenant_id"],
    )
    op.create_index(
        "idx_cbs_links_doc",
        "cbs_document_links",
        ["document_id"],
    )
    op.create_index(
        "idx_cbs_links_cif",
        "cbs_document_links",
        ["tenant_id", "cif"],
    )
    op.create_index(
        "idx_cbs_links_linked_at",
        "cbs_document_links",
        ["linked_at"],
        # SQLAlchemy op.create_index does not take a DESC keyword;
        # the descending hint is advisory for query planners that support it.
        # Postgres: add DESC in a raw migration if needed; SQLite ignores it.
    )

    # ------------------------------------------------------------------
    # cbs_circuit_events
    # ------------------------------------------------------------------
    op.create_table(
        "cbs_circuit_events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("adapter", sa.String(64), nullable=False, server_default="temenos"),
        sa.Column("state_from", sa.String(16), nullable=False),
        sa.Column("state_to", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(64), nullable=True),
        sa.Column("consecutive_errors", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "event_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "idx_cbs_circuit_tenant",
        "cbs_circuit_events",
        ["tenant_id", "event_at"],
    )


def downgrade() -> None:
    # Drop in reverse order (no cross-table FKs between these two tables).
    op.drop_index("idx_cbs_circuit_tenant", table_name="cbs_circuit_events")
    op.drop_table("cbs_circuit_events")

    op.drop_index("idx_cbs_links_linked_at", table_name="cbs_document_links")
    op.drop_index("idx_cbs_links_cif", table_name="cbs_document_links")
    op.drop_index("idx_cbs_links_doc", table_name="cbs_document_links")
    op.drop_index("idx_cbs_links_tenant", table_name="cbs_document_links")
    op.drop_table("cbs_document_links")

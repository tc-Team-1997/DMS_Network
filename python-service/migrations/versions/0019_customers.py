"""Add customers and audit_log tables for CBS/KYC CIF link layer.

customers   — CBS-sourced customer records upserted by the KYC/CIF service.
              Unique on (cif, tenant_id) to enforce tenant isolation.
audit_log   — Append-only audit trail written by kyc_cif_service and any
              service that needs a durable, human-readable trail.

Revision ID: 0019_customers
Revises: 0018_doctype_samples
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_customers"
down_revision = "0018_doctype_samples"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. customers — CBS-sourced customer records
    # ------------------------------------------------------------------
    op.create_table(
        "customers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("cif", sa.String(64), nullable=False),
        sa.Column("name", sa.String(512)),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("cbs_source", sa.String(64), server_default="temenos_t24"),
        sa.Column("last_synced_at", sa.DateTime),
        sa.Column("raw_json", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.UniqueConstraint("cif", "tenant_id", name="uq_customer_cif_tenant"),
    )
    op.create_index("idx_customers_cif", "customers", ["cif"])
    op.create_index("idx_customers_tenant_id", "customers", ["tenant_id"])
    op.create_index("idx_customers_last_synced_at", "customers", ["last_synced_at"])

    # ------------------------------------------------------------------
    # 2. audit_log — append-only audit trail
    # ------------------------------------------------------------------
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant", sa.String(64), nullable=False),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("resource_type", sa.String(64)),
        sa.Column("resource_id", sa.String(128)),
        sa.Column("detail", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("idx_audit_log_tenant", "audit_log", ["tenant"])
    op.create_index("idx_audit_log_actor", "audit_log", ["actor"])
    op.create_index("idx_audit_log_action", "audit_log", ["action"])
    op.create_index("idx_audit_log_resource_type", "audit_log", ["resource_type"])
    op.create_index("idx_audit_log_resource_id", "audit_log", ["resource_id"])
    op.create_index("idx_audit_log_created_at", "audit_log", ["created_at"])


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("customers")

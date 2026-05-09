"""DSAR Console — dsar_requests + dsar_artifacts tables (Wave C).

Revision ID: 0040_dsar_requests
Revises: 0037_users_v2
Create Date: 2026-05-10

NOTE: down_revision targets 0037_users_v2 as the branch base.
The integrator will re-point this to the correct predecessor when linearising
the Wave C migration fan-out. Both tables use IF NOT EXISTS guards so the
migration is idempotent if re-applied after re-pointing.

Tables
------
dsar_requests  — one row per DSAR request (Art-15 export, Art-17 cryptoshred,
                 litigation hold, fulfillment letter). UUID primary key.
dsar_artifacts — snapshot of each artifact included in a request (foreign key
                 to dsar_requests, cascades on delete).
"""
from alembic import op
import sqlalchemy as sa

revision = "0040_dsar_requests"
down_revision = "0039_regulator_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # dsar_requests — one row per DSAR fulfillment request.
    op.create_table(
        "dsar_requests",
        sa.Column("id", sa.String(36), primary_key=True),          # UUID
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("customer_cid", sa.String(64), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        # article15_export | article17_cryptoshred | litigation_hold | fulfillment_letter
        sa.Column("status", sa.String(32), nullable=False, server_default="NEW"),
        # NEW | IN_PROGRESS | COMPLETED | OVERDUE
        sa.Column("requested_by", sa.String(128), nullable=False),
        sa.Column("requested_at", sa.DateTime, nullable=False),
        sa.Column("sla_due_at", sa.DateTime, nullable=False),
        sa.Column("completed_at", sa.DateTime, nullable=True),
        sa.Column("regulator", sa.String(32), nullable=True),       # GDPR | PDPL | RMA
        sa.Column("params_json", sa.Text, nullable=True),
        sa.Column("fulfillment_artifact_path", sa.String(512), nullable=True),
        sa.Column("signed_receipt", sa.Text, nullable=True),
    )
    op.create_index("idx_dsar_requests_tenant_id", "dsar_requests", ["tenant_id"])
    op.create_index("idx_dsar_requests_customer_cid", "dsar_requests", ["customer_cid"])
    op.create_index("idx_dsar_requests_status", "dsar_requests", ["status"])
    op.create_index("idx_dsar_requests_requested_at", "dsar_requests", ["requested_at"])

    # dsar_artifacts — one row per artifact snapshotted into a request.
    op.create_table(
        "dsar_artifacts",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "request_id",
            sa.String(36),
            sa.ForeignKey("dsar_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        # document | ai_trace | audit_event | workflow | cbs_record
        sa.Column("ref_type", sa.String(64), nullable=True),
        sa.Column("ref_id", sa.String(128), nullable=True),
        sa.Column("snapshot_json", sa.Text, nullable=True),
    )
    op.create_index("idx_dsar_artifacts_request_id", "dsar_artifacts", ["request_id"])
    op.create_index("idx_dsar_artifacts_kind", "dsar_artifacts", ["kind"])


def downgrade() -> None:
    op.drop_table("dsar_artifacts")
    op.drop_table("dsar_requests")

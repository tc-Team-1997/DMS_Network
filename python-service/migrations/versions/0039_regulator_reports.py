"""Regulator Reports — Wave C.

Two new tables:
  - regulator_reports: template registry (regulator, format, parameters_schema,
    query_template, output_template_path, schedule_cron, etc.)
  - submission_receipts: audit log of every generated report, with SHA-256 +
    RSA-PSS detached signature for non-repudiation.

Formats supported: pdf, csv, jsonld.
(XLSX/SheetJS absent from package.json — CSV used instead; noted in deviation log.)

JSON-LD context: W3C Data Privacy Vocabulary (DPV) for RoPA / PDPL templates.
Plain JSON for RMA / CBE / SAMA / RBI.

Revision ID  : 0039_regulator_reports
Revises      : 0037_users_v2
  NOTE: down_revision deliberately points at 0037_users_v2.  If the integrator
  inserts 0038 (e.g. audit_fts) before this migration, re-point down_revision
  to that revision.  Both tables use CREATE TABLE IF NOT EXISTS semantics via
  checkfirst=True so re-applying is idempotent.
Create Date  : 2026-05-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0039_regulator_reports"
down_revision = "0038_audit_fts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "regulator_reports",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Text, nullable=False, server_default="default"),
        sa.Column("regulator", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        # JSON Schema string describing the parameters the template accepts.
        sa.Column("parameters_schema_json", sa.Text, nullable=False, server_default="{}"),
        # SQL template string — may use :as_of_date and named params from parameters_schema.
        sa.Column("query_template", sa.Text, nullable=False, server_default=""),
        # Path to a Jinja2 / plain-text output template (relative to STORAGE_DIR).
        sa.Column("output_template_path", sa.Text, nullable=True),
        sa.Column(
            "format",
            sa.Text,
            nullable=False,
            server_default="pdf",
            comment="pdf | csv | jsonld",
        ),
        sa.Column("is_active", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.Text,
            nullable=False,
            server_default=sa.text("(datetime('now'))"),
        ),
        sa.Column(
            "updated_at",
            sa.Text,
            nullable=False,
            server_default=sa.text("(datetime('now'))"),
        ),
        # Cron expression for scheduled generation, e.g. "0 6 1 * *" (monthly).
        sa.Column("schedule_cron", sa.Text, nullable=True),
        if_not_exists=True,
    )
    op.create_index(
        "ix_rr_tenant_regulator",
        "regulator_reports",
        ["tenant_id", "regulator"],
        if_not_exists=True,
    )

    op.create_table(
        "submission_receipts",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Text, nullable=False, server_default="default"),
        sa.Column("report_template_id", sa.Integer, nullable=False),
        sa.Column(
            "generated_at",
            sa.Text,
            nullable=False,
            server_default=sa.text("(datetime('now'))"),
        ),
        sa.Column("generated_by", sa.Text, nullable=True, comment="username"),
        # JSON snapshot of the params used when generating.
        sa.Column("params_json", sa.Text, nullable=False, server_default="{}"),
        sa.Column("file_path", sa.Text, nullable=True),
        sa.Column("sha256", sa.Text, nullable=True),
        # JSON manifest from services/signing.py::sign_detached.
        sa.Column("signature", sa.Text, nullable=True),
        sa.Column("submitted_at", sa.Text, nullable=True),
        sa.Column("regulator_endpoint", sa.Text, nullable=True),
        sa.Column("response_code", sa.Integer, nullable=True),
        sa.Column("response_body", sa.Text, nullable=True),
        if_not_exists=True,
    )
    op.create_index(
        "ix_sr_tenant_template",
        "submission_receipts",
        ["tenant_id", "report_template_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_sr_generated_at",
        "submission_receipts",
        ["generated_at"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_sr_generated_at", table_name="submission_receipts")
    op.drop_index("ix_sr_tenant_template", table_name="submission_receipts")
    op.drop_table("submission_receipts")
    op.drop_index("ix_rr_tenant_regulator", table_name="regulator_reports")
    op.drop_table("regulator_reports")

"""Add multi-page redaction tables (Viewer v2, migration 0029).

Tables added:
  redactions       — parent record per redaction event
  redaction_pages  — per-page bounding boxes; composite PK (redaction_id, page)

These tables are additive.  The existing redaction_log table (0024) is
unchanged — it remains the Python-side audit trail.  redactions / redaction_pages
are the Node-side storage layer so the SPA can submit per-page burn-in
coordinates without page-0 truncation.

Revision ID  : 0029_redactions_multi_page
Revises      : 0028_workflows_actions
Create Date  : 2026-05-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0029_redactions_multi_page"
down_revision = "0028_workflows_actions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── redactions ───────────────────────────────────────────────────────────
    op.create_table(
        "redactions",
        sa.Column("redaction_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("documents.id"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("reason", sa.String(256), nullable=True),
    )
    op.create_index("idx_redactions_document", "redactions", ["document_id"])

    # ── redaction_pages ──────────────────────────────────────────────────────
    op.create_table(
        "redaction_pages",
        sa.Column("redaction_id", sa.Integer(), nullable=False),
        sa.Column("page",         sa.Integer(), nullable=False),
        sa.Column("x",            sa.Integer(), nullable=False),
        sa.Column("y",            sa.Integer(), nullable=False),
        sa.Column("w",            sa.Integer(), nullable=False),
        sa.Column("h",            sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("redaction_id", "page"),
        sa.ForeignKeyConstraint(
            ["redaction_id"],
            ["redactions.redaction_id"],
        ),
    )
    op.create_index("idx_redaction_pages_rid", "redaction_pages", ["redaction_id"])


def downgrade() -> None:
    op.drop_index("idx_redaction_pages_rid", table_name="redaction_pages")
    op.drop_table("redaction_pages")
    op.drop_index("idx_redactions_document", table_name="redactions")
    op.drop_table("redactions")

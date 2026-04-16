"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("original_name", sa.String(512), nullable=False),
        sa.Column("mime_type", sa.String(128)),
        sa.Column("size_bytes", sa.Integer),
        sa.Column("sha256", sa.String(64), index=True),
        sa.Column("phash", sa.String(32), index=True),
        sa.Column("doc_type", sa.String(64)),
        sa.Column("customer_cid", sa.String(64), index=True),
        sa.Column("branch", sa.String(128)),
        sa.Column("status", sa.String(32), server_default="captured"),
        sa.Column("issue_date", sa.String(32)),
        sa.Column("expiry_date", sa.String(32)),
        sa.Column("uploaded_by", sa.String(128)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "ocr_results",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("document_id", sa.Integer, sa.ForeignKey("documents.id", ondelete="CASCADE"), unique=True),
        sa.Column("text", sa.Text),
        sa.Column("confidence", sa.Float),
        sa.Column("fields_json", sa.Text),
        sa.Column("engine", sa.String(64), server_default="tesseract"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "workflow_steps",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("document_id", sa.Integer, sa.ForeignKey("documents.id", ondelete="CASCADE")),
        sa.Column("stage", sa.String(64)),
        sa.Column("actor", sa.String(128)),
        sa.Column("action", sa.String(32)),
        sa.Column("comment", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "integration_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("system", sa.String(32)),
        sa.Column("endpoint", sa.String(256)),
        sa.Column("method", sa.String(8)),
        sa.Column("status_code", sa.Integer),
        sa.Column("latency_ms", sa.Integer),
        sa.Column("request_json", sa.Text),
        sa.Column("response_json", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_table(
        "duplicate_matches",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("doc_a", sa.Integer, sa.ForeignKey("documents.id", ondelete="CASCADE")),
        sa.Column("doc_b", sa.Integer, sa.ForeignKey("documents.id", ondelete="CASCADE")),
        sa.Column("similarity", sa.Float),
        sa.Column("match_type", sa.String(32)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("duplicate_matches")
    op.drop_table("integration_logs")
    op.drop_table("workflow_steps")
    op.drop_table("ocr_results")
    op.drop_table("documents")

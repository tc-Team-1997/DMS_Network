"""Add document_type_schemas, document_type_samples and doctype_sample_chunks
tables (migration 0018 — DocBrain sample library).

``document_type_schemas`` does not exist in the Python service DB prior to
this migration (it lives in the Node SQLite schema).  We create it here with
all columns — the four DocBrain inference columns included — so the Python
service's Alembic chain is self-contained.

If this migration is ever run against a DB that already has the table (e.g.
a future Postgres cutover where the Node schema was imported first) the
``op.create_table`` call will raise; wrap with a dialect check at that point.

Revision ID: 0018_doctype_samples
Revises: 0017_user_notification_preferences
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0018_doctype_samples"
down_revision = "0017_user_notification_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Base table: document_type_schemas
    #    Created here (not via ALTER) because the Python service DB does
    #    not inherit the Node SQLite schema.  All four DocBrain inference
    #    columns are included from the start — no ALTER needed.
    # ------------------------------------------------------------------
    op.create_table(
        "document_type_schemas",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("description", sa.Text),
        sa.Column("fields_json", sa.Text, nullable=False, server_default="[]"),
        sa.Column("active", sa.Integer, server_default="1"),
        sa.Column("tenant_id", sa.String(64), nullable=False, server_default="nbe"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        # DocBrain inference state
        sa.Column("schema_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "inference_status",
            sa.String(32),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "source_samples_count", sa.Integer, nullable=False, server_default="0"
        ),
        sa.Column(
            "vector_index_version", sa.Integer, nullable=False, server_default="0"
        ),
    )
    op.create_index(
        "idx_doctype_schemas_name", "document_type_schemas", ["name"]
    )
    op.create_index(
        "idx_doctype_schemas_tenant", "document_type_schemas", ["tenant_id"]
    )

    # ------------------------------------------------------------------
    # 2. New table: document_type_samples
    # ------------------------------------------------------------------
    op.create_table(
        "document_type_samples",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "schema_id",
            sa.Integer,
            sa.ForeignKey("document_type_schemas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename",            sa.String(512), nullable=False),
        sa.Column("sha256",              sa.String(64),  nullable=False),
        sa.Column("storage_key",         sa.String(512), nullable=False),
        sa.Column("size",                sa.Integer,     nullable=False),
        sa.Column("mime_type",           sa.String(128), nullable=False),
        sa.Column("ocr_text",            sa.Text),
        sa.Column("ocr_backend",         sa.String(64)),
        sa.Column("ocr_mean_confidence", sa.Float),
        sa.Column("schema_version",      sa.Integer,     nullable=False, server_default="1"),
        sa.Column("uploaded_by",         sa.String(128)),
        sa.Column("uploaded_at",         sa.DateTime,    server_default=sa.func.now()),
        sa.Column("tenant_id",           sa.String(64),  nullable=False, server_default="nbe"),
        sa.UniqueConstraint("schema_id", "sha256", name="uq_sample_schema_sha256"),
    )
    op.create_index(
        "idx_doctype_samples_schema", "document_type_samples", ["schema_id"]
    )
    op.create_index(
        "idx_doctype_samples_sha256", "document_type_samples", ["sha256"]
    )
    op.create_index(
        "idx_doctype_samples_tenant", "document_type_samples", ["tenant_id"]
    )

    # ------------------------------------------------------------------
    # 3. New table: doctype_sample_chunks
    # ------------------------------------------------------------------
    op.create_table(
        "doctype_sample_chunks",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "sample_id",
            sa.Integer,
            sa.ForeignKey("document_type_samples.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chunk_index", sa.Integer, nullable=False, server_default="0"),
        sa.Column("page", sa.Integer),
        sa.Column("text_snippet", sa.Text),
        sa.Column("embedding", sa.LargeBinary),
        sa.Column("model_name", sa.String(128)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index(
        "idx_sample_chunks_sample", "doctype_sample_chunks", ["sample_id"]
    )


def downgrade() -> None:
    # Drop all three tables in reverse dependency order.
    op.drop_table("doctype_sample_chunks")
    op.drop_table("document_type_samples")
    op.drop_table("document_type_schemas")

"""DocTypes v2 — doctype_versions + doctype_field_bbox tables, notify_days
+ translate_extracted_to_dz columns on document_type_schemas, and
doctype_version_id FK on workflow_steps.

Revision ID  : 0031_doctype_versions
Revises      : 0030_saved_searches
Create Date  : 2026-05-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0031_doctype_versions"
down_revision = "0030_saved_searches"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── doctype_versions ────────────────────────────────────────────────────
    op.create_table(
        "doctype_versions",
        sa.Column("id",          sa.Integer(),    primary_key=True, autoincrement=True),
        sa.Column("doctype_id",  sa.Integer(),    nullable=False),
        sa.Column("version",     sa.Integer(),    nullable=False, server_default="1"),
        sa.Column("schema_json", sa.Text(),       nullable=False, server_default="[]"),
        sa.Column("created_by",  sa.String(128),  nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.CheckConstraint(
            "status IN ('draft', 'live', 'archived')",
            name="ck_doctype_versions_status",
        ),
        sa.ForeignKeyConstraint(
            ["doctype_id"],
            ["document_type_schemas.id"],
            ondelete="CASCADE",
            name="fk_dv_doctype",
        ),
        sa.UniqueConstraint("doctype_id", "version", name="uq_dv_doctype_version"),
    )
    op.create_index("idx_doctype_versions_doctype", "doctype_versions", ["doctype_id"])
    op.create_index(
        "idx_doctype_versions_status", "doctype_versions", ["doctype_id", "status"]
    )

    # ── doctype_field_bbox ──────────────────────────────────────────────────
    op.create_table(
        "doctype_field_bbox",
        sa.Column("id",                 sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("doctype_version_id", sa.Integer(), nullable=False),
        sa.Column("field_name",         sa.String(64),  nullable=False),
        sa.Column("page",               sa.Integer(),   nullable=False, server_default="1"),
        sa.Column("x",                  sa.Float(),     nullable=False),
        sa.Column("y",                  sa.Float(),     nullable=False),
        sa.Column("w",                  sa.Float(),     nullable=False),
        sa.Column("h",                  sa.Float(),     nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="confirmed"),
        sa.CheckConstraint(
            "source IN ('confirmed', 'ai_proposed')",
            name="ck_dfbbox_source",
        ),
        sa.ForeignKeyConstraint(
            ["doctype_version_id"],
            ["doctype_versions.id"],
            ondelete="CASCADE",
            name="fk_dfbbox_version",
        ),
    )
    op.create_index("idx_dfbbox_version", "doctype_field_bbox", ["doctype_version_id"])

    # ── additive columns on document_type_schemas ───────────────────────────
    # Use batch_alter_table so SQLite does not choke on a plain ADD COLUMN
    # when alembic is configured with render_as_batch=True (env.py sets this).
    with op.batch_alter_table("document_type_schemas") as bop:
        bop.add_column(
            sa.Column(
                "notify_days",
                sa.String(64),
                nullable=False,
                server_default="30,60,90",
            )
        )
        bop.add_column(
            sa.Column(
                "translate_extracted_to_dz",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )

    # ── doctype_version_id FK on workflow_steps ──────────────────────────────
    # workflow_steps is the Python-side state-machine journal; nullable so
    # existing rows and non-doctype workflows are unaffected.
    with op.batch_alter_table("workflow_steps") as bop:
        bop.add_column(
            sa.Column(
                "doctype_version_id",
                sa.Integer(),
                sa.ForeignKey("doctype_versions.id"),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("workflow_steps") as bop:
        bop.drop_column("doctype_version_id")
    with op.batch_alter_table("document_type_schemas") as bop:
        bop.drop_column("translate_extracted_to_dz")
        bop.drop_column("notify_days")
    op.drop_index("idx_dfbbox_version", table_name="doctype_field_bbox")
    op.drop_table("doctype_field_bbox")
    op.drop_index("idx_doctype_versions_status", table_name="doctype_versions")
    op.drop_index("idx_doctype_versions_doctype", table_name="doctype_versions")
    op.drop_table("doctype_versions")

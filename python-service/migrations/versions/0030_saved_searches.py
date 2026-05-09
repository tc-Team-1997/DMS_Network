"""Search v2 — saved_searches table with correct scope CHECK and last_run_at.

The Node SQLite schema already has a saved_searches table but with:
  - scope CHECK ('private', 'public') — wrong; spec requires ('private','team','tenant')
  - missing last_run_at column
  - missing branch column (needed for team-scope lookups)

This migration creates the canonical Python-service version of the table.
The Node-side migration (rename-recreate-copy-drop) is handled separately in
db/schema.sql + the migration note below.

FK check result (run before this migration was authored):
  grep -n "REFERENCES saved_searches" db/schema.sql python-service/app/models.py
  → empty; saved_searches is a leaf table. Safe to recreate.

Revision ID  : 0030_saved_searches
Revises      : 0029_redactions_multi_page
Create Date  : 2026-05-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0030_saved_searches"
down_revision = "0029_redactions_multi_page"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_searches",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, server_default="nbe"),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("query_json", sa.Text, nullable=False),
        sa.Column(
            "scope",
            sa.String(16),
            nullable=False,
            server_default="private",
        ),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("last_run_at", sa.DateTime, nullable=True),
        # branch: user's branch at save time — used for team-scope visibility.
        sa.Column("branch", sa.String(128), nullable=True),
        sa.CheckConstraint(
            "scope IN ('private', 'team', 'tenant')",
            name="ck_saved_searches_scope",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.tenant_id"]),
    )
    op.create_index(
        "idx_saved_searches_user",
        "saved_searches",
        ["user_id"],
    )
    op.create_index(
        "idx_saved_searches_tenant_scope",
        "saved_searches",
        ["tenant_id", "scope"],
    )


def downgrade() -> None:
    op.drop_index("idx_saved_searches_tenant_scope", table_name="saved_searches")
    op.drop_index("idx_saved_searches_user", table_name="saved_searches")
    op.drop_table("saved_searches")

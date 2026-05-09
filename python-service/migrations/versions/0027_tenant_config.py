"""Add tenants, tenant_config, and tenant_config_history tables (CC1).

Implements the configuration-first, bank-agnostic platform foundation:

  tenants              — registry of tenant organisations (one row per bank /
                         institution). tenant_id='nbe' maps to Bank of Bhutan.
  tenant_config        — current live config values, keyed by
                         (tenant_id, namespace, key). Value is JSON-encoded text.
  tenant_config_history — append-only audit log with SHA-256 hash chain.
                         changed_at is set client-side (never server-default)
                         so that hash(prev_hash || canonical_json(row)) is
                         deterministically verifiable after the INSERT.

All changes are strictly additive — no existing table is modified.

Revision ID  : 0027_tenant_config
Revises      : 0026_translations
Create Date  : 2026-05-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0027_tenant_config"
down_revision = "0026_translations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # tenants — must come first; tenant_config has a FK to it.
    # ------------------------------------------------------------------
    op.create_table(
        "tenants",
        sa.Column("tenant_id", sa.String(64), primary_key=True),
        sa.Column("slug", sa.String(128), nullable=False, unique=True),
        sa.Column("display_name", sa.String(256), nullable=False),
        sa.Column("regulator_name", sa.String(256), nullable=False),
        sa.Column("regulator_short", sa.String(32), nullable=False),
        sa.Column(
            "default_locale",
            sa.String(16),
            nullable=False,
            server_default="en",
        ),
        sa.Column(
            "allowed_locales",
            sa.Text,
            nullable=False,
            server_default='["en"]',
        ),
        sa.Column(
            "primary_color",
            sa.String(16),
            nullable=False,
            server_default="#0D2B6A",
        ),
        sa.Column(
            "monogram",
            sa.String(8),
            nullable=False,
            server_default="DM",
        ),
        sa.Column("logo_path", sa.Text, nullable=True),
        sa.Column("favicon_path", sa.Text, nullable=True),
        sa.Column("login_banner", sa.Text, nullable=True),
        sa.Column("footer_text", sa.Text, nullable=True),
        sa.Column("environment_label", sa.String(64), nullable=True),
        sa.Column(
            "is_active",
            sa.Integer,
            nullable=False,
            server_default="1",
        ),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
    )

    # ------------------------------------------------------------------
    # tenant_config — composite PK (tenant_id, namespace, key).
    # value is JSON-encoded text; same pattern used throughout codebase.
    # ------------------------------------------------------------------
    op.create_table(
        "tenant_config",
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("namespace", sa.String(64), nullable=False),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column(
            "schema_version",
            sa.Integer,
            nullable=False,
            server_default="1",
        ),
        sa.Column("updated_by", sa.Integer, nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.PrimaryKeyConstraint("tenant_id", "namespace", "key"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.tenant_id"]),
    )
    op.create_index(
        "idx_tenant_config_ns",
        "tenant_config",
        ["tenant_id", "namespace"],
    )

    # ------------------------------------------------------------------
    # tenant_config_history — append-only hash-chain audit log.
    # changed_at has NO server_default: the service layer supplies an
    # explicit UTC timestamp before computing the hash so that
    # hash(prev_hash || canonical_json(row)) stays verifiable.
    # ------------------------------------------------------------------
    op.create_table(
        "tenant_config_history",
        sa.Column("history_id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("namespace", sa.String(64), nullable=False),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("schema_version", sa.Integer, nullable=False),
        sa.Column("changed_by", sa.Integer, nullable=True),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("changed_at", sa.String(32), nullable=False),   # ISO-8601 UTC, no server default
        sa.Column("prev_hash", sa.String(64), nullable=True),
        sa.Column("hash", sa.String(64), nullable=False),
    )
    op.create_index(
        "idx_tcfg_hist",
        "tenant_config_history",
        ["tenant_id", "namespace", "key", "changed_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_tcfg_hist", table_name="tenant_config_history")
    op.drop_table("tenant_config_history")
    op.drop_index("idx_tenant_config_ns", table_name="tenant_config")
    op.drop_table("tenant_config")
    op.drop_table("tenants")

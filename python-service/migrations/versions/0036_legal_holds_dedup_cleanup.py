"""Migration 0036 — legal_holds table + dedup_settings → tenant_config migration + DROP.

Changes:
  1. CREATE TABLE legal_holds(id, doc_id, applied_by, applied_at, released_by,
     released_at, reason, tenant_id) with FK to documents and indexes.
  2. Data-migrate every row in dedup_settings → tenant_config rows:
       namespace='capture', key='dedup.fuzzy_min_ratio',  value=fuzzy_threshold (fraction)
       namespace='capture', key='dedup.phash_max_distance', value=phash_distance (int)
     Uses op.execute() + raw SQL loop. Only inserts when the tenant_config row does
     not yet exist (INSERT OR IGNORE) so re-runs are safe.
  3. DROP TABLE dedup_settings after the data migration.

The dedup_settings table is now SAFE TO DROP because:
  - All values are preserved in tenant_config.capture.dedup.*
  - services/duplicates.js and the Python dedup service both prefer tenant_config
    (CC1) and fall back to DEFAULTS; the legacy table fallback is removed in this wave.

Revision ID  : 0036_legal_holds_dedup_cleanup
Revises      : 0035_aml_360
Create Date  : 2026-05-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "0036_legal_holds_dedup_cleanup"
down_revision = "0035_aml_360"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. CREATE TABLE legal_holds ──────────────────────────────────────────
    op.create_table(
        "legal_holds",
        sa.Column("id",          sa.Integer(),    primary_key=True, autoincrement=True),
        sa.Column("doc_id",      sa.Integer(),    nullable=False),
        sa.Column("applied_by",  sa.String(128),  nullable=False),
        sa.Column("applied_at",  sa.DateTime(),   nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("released_by", sa.String(128),  nullable=True),
        sa.Column("released_at", sa.DateTime(),   nullable=True),
        sa.Column("reason",      sa.String(512),  nullable=False),
        sa.Column("tenant_id",   sa.String(64),   nullable=False, server_default="nbe"),
        sa.ForeignKeyConstraint(
            ["doc_id"], ["documents.id"],
            ondelete="CASCADE",
            name="fk_legal_holds_doc",
        ),
    )
    op.create_index("idx_legal_holds_doc",    "legal_holds", ["doc_id"])
    op.create_index("idx_legal_holds_tenant", "legal_holds", ["tenant_id"])

    # ── 2. Migrate dedup_settings → tenant_config ────────────────────────────
    # Check whether dedup_settings exists (may not be present in Python-service
    # DB if this service was never given the legacy Node table).
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "dedup_settings" in tables:
        rows = conn.execute(
            text("SELECT tenant_id, fuzzy_threshold, phash_distance FROM dedup_settings")
        ).fetchall()

        import json
        from datetime import datetime

        now_iso = datetime.utcnow().isoformat()

        for row in rows:
            tenant_id      = row[0] or "nbe"
            fuzzy_fraction = row[1] if row[1] is not None else 0.8
            phash_dist     = row[2] if row[2] is not None else 10

            # Insert fuzzy_min_ratio (stored as-is, 0–1 fraction)
            conn.execute(text("""
                INSERT OR IGNORE INTO tenant_config
                    (tenant_id, namespace, key, value, schema_version, updated_at)
                VALUES (:tid, 'capture', 'dedup.fuzzy_min_ratio', :val, 1, :ts)
            """), {"tid": tenant_id, "val": json.dumps(fuzzy_fraction), "ts": now_iso})

            # Insert phash_max_distance (integer)
            conn.execute(text("""
                INSERT OR IGNORE INTO tenant_config
                    (tenant_id, namespace, key, value, schema_version, updated_at)
                VALUES (:tid, 'capture', 'dedup.phash_max_distance', :val, 1, :ts)
            """), {"tid": tenant_id, "val": json.dumps(int(phash_dist)), "ts": now_iso})

        # ── 3. DROP TABLE dedup_settings ────────────────────────────────────
        op.drop_table("dedup_settings")


def downgrade() -> None:
    # Recreate dedup_settings (no data restoration — values live in tenant_config).
    op.create_table(
        "dedup_settings",
        sa.Column("tenant_id",       sa.String(64),  primary_key=True),
        sa.Column("fuzzy_threshold",  sa.Float(),     server_default="0.8"),
        sa.Column("phash_distance",   sa.Integer(),   server_default="10"),
        sa.Column("updated_at",       sa.DateTime(),  server_default=sa.func.current_timestamp()),
        sa.Column("updated_by",       sa.Integer(),   nullable=True),
    )

    op.drop_index("idx_legal_holds_tenant", table_name="legal_holds")
    op.drop_index("idx_legal_holds_doc",    table_name="legal_holds")
    op.drop_table("legal_holds")

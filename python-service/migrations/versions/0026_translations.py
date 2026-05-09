"""Add translations cache table for offline NLLB-200 translation service.

Implements the 7-day TTL translation cache for the Dzongkha translation
feature (BHU-14).  All changes are strictly additive — no existing table
is altered.

Schema:
  translations.cache_key   — SHA-256(text || source || target); PRIMARY KEY
  translations.tenant_id   — tenant boundary; every query must filter on this
  translations.source_lang — short code: en / dz / ar
  translations.target_lang — short code: en / dz / ar
  translations.translated_text — the translated content (may contain PII)
  translations.created_at  — UTC timestamp of initial cache write
  translations.expires_at  — created_at + 7 days; pruned by cron helper
  translations.deleted_at  — soft-delete for DSAR erasure; NULL = active

Revision ID  : 0026_translations
Revises      : 0023_worm_retention
Create Date  : 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0026_translations"
down_revision = "0025_face_match"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "translations",
        sa.Column("cache_key", sa.Text, primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Text,
            nullable=False,
            server_default="default",
        ),
        sa.Column("source_lang", sa.Text, nullable=False),
        sa.Column("target_lang", sa.Text, nullable=False),
        sa.Column("translated_text", sa.Text, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.Column("deleted_at", sa.DateTime, nullable=True),
    )

    op.create_index(
        "idx_translations_tenant",
        "translations",
        ["tenant_id"],
    )
    op.create_index(
        "idx_translations_expires",
        "translations",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_translations_expires", table_name="translations")
    op.drop_index("idx_translations_tenant", table_name="translations")
    op.drop_table("translations")

"""Add biometric KYC tables for face-match feature (BHU-9).

Three new tables (additive only — no existing table is modified):

  biometric_consent      — GDPR consent audit trail (7-year retention).
  biometric_encodings    — 128-dim face encoding cache for ID photos only
                           (90-day retention; live-photo encodings never stored).
  biometric_match        — Append-only audit record of every match decision
                           (10-year regulatory retention; SHA-256 hashes only,
                           no raw images, no encodings).

Also adds face_match_threshold column to tenant_settings (if table exists).

Security / DPIA compliance:
  - biometric_encodings.face_encoding (BLOB) should be encrypted at rest (AES-256).
  - Raw images are NEVER stored. Only non-reversible 128-dim float64 vectors.
  - All tables carry tenant_id NOT NULL for tenant isolation.

Revision ID : 0025_face_match
Revises     : 0022_cbs_document_links
Create Date : 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0025_face_match"
down_revision = "0024_redaction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # biometric_consent  — must come first (BiometricMatch FK references it)
    # ------------------------------------------------------------------
    op.create_table(
        "biometric_consent",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("customer_cid", sa.String(64), nullable=False),
        sa.Column("consent_version", sa.String(16), nullable=False),
        sa.Column("language", sa.String(2), nullable=False, server_default="en"),
        sa.Column(
            "given_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("signature_or_approval", sa.String(256), nullable=True),
        sa.Column("expires_at", sa.DateTime, nullable=True),
        sa.Column("revoked_at", sa.DateTime, nullable=True),
    )
    op.create_index(
        "idx_biometric_consent_tenant",
        "biometric_consent",
        ["tenant_id"],
    )
    op.create_index(
        "idx_biometric_consent_customer",
        "biometric_consent",
        ["customer_cid", "given_at"],
    )

    # ------------------------------------------------------------------
    # biometric_encodings  — ID photo encoding cache
    # ------------------------------------------------------------------
    op.create_table(
        "biometric_encodings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        # SHA-256 hex digest of the raw image bytes (64 chars)
        sa.Column("photo_sha256", sa.String(64), nullable=False, unique=True),
        sa.Column("photo_type", sa.String(16), nullable=False),   # 'id_photo'
        # 128-dim float64 array stored as raw bytes (~1024 bytes). NEVER the raw image.
        sa.Column("face_encoding", sa.LargeBinary, nullable=False),
        # Optional geometry metadata: {eye_distance_px, head_pose_deg, face_count}
        sa.Column("face_geometry", sa.JSON, nullable=True),
        sa.Column(
            "encoding_model",
            sa.String(128),
            nullable=False,
            server_default="face_recognition/dlib",
        ),
        sa.Column(
            "created_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        # Encoding expires after 90 days (tenant configurable via tenant_settings).
        # A cron job prunes rows where expires_at < now().
        sa.Column(
            "expires_at",
            sa.DateTime,
            nullable=False,
            # SQLite: add 90 days to current timestamp
            server_default=sa.text("datetime(CURRENT_TIMESTAMP, '+90 days')"),
        ),
    )
    op.create_index(
        "idx_biometric_encodings_tenant_sha256",
        "biometric_encodings",
        ["tenant_id", "photo_sha256"],
    )
    op.create_index(
        "idx_biometric_encodings_expires_at",
        "biometric_encodings",
        ["expires_at"],
    )

    # ------------------------------------------------------------------
    # biometric_match  — append-only match decision audit log
    # ------------------------------------------------------------------
    op.create_table(
        "biometric_match",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("customer_cid", sa.String(64), nullable=False),
        sa.Column(
            "doc_id",
            sa.Integer,
            sa.ForeignKey("documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # SHA-256 of id_photo bytes (for cache linkage; not reversible to image).
        sa.Column("id_photo_sha256", sa.String(64), nullable=False),
        # SHA-256 of live_photo bytes (not stored in encodings; audit trail only).
        sa.Column("live_photo_sha256", sa.String(64), nullable=False),
        sa.Column("distance", sa.Float, nullable=False),
        sa.Column("confidence", sa.Float, nullable=False),
        sa.Column("match_result", sa.Boolean, nullable=False),
        sa.Column("face_geometry_ok", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("threshold_used", sa.Float, nullable=False),
        sa.Column(
            "decided_at",
            sa.DateTime,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("decided_by", sa.String(128), nullable=True),
        sa.Column("decided_from", sa.String(16), nullable=True),    # 'mobile' | 'web' | 'api'
        sa.Column(
            "consent_token_id",
            sa.Integer,
            sa.ForeignKey("biometric_consent.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_biometric_match_tenant_customer",
        "biometric_match",
        ["tenant_id", "customer_cid"],
    )
    op.create_index(
        "idx_biometric_match_doc_id",
        "biometric_match",
        ["doc_id"],
    )
    op.create_index(
        "idx_biometric_match_decided_at",
        "biometric_match",
        ["decided_at"],
    )

    # ------------------------------------------------------------------
    # tenant_settings.face_match_threshold  — admin-tunable per tenant
    # Gracefully skip if tenant_settings table does not exist in this DB.
    # ------------------------------------------------------------------
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if "tenant_settings" in inspector.get_table_names():
        existing_cols = [c["name"] for c in inspector.get_columns("tenant_settings")]
        if "face_match_threshold" not in existing_cols:
            op.add_column(
                "tenant_settings",
                sa.Column(
                    "face_match_threshold",
                    sa.Float,
                    nullable=False,
                    server_default="0.6",
                ),
            )
        if "face_encoding_retention_days" not in existing_cols:
            op.add_column(
                "tenant_settings",
                sa.Column(
                    "face_encoding_retention_days",
                    sa.Integer,
                    nullable=False,
                    server_default="90",
                ),
            )
        if "biometric_consent_required" not in existing_cols:
            op.add_column(
                "tenant_settings",
                sa.Column(
                    "biometric_consent_required",
                    sa.Boolean,
                    nullable=False,
                    server_default="0",
                ),
            )


def downgrade() -> None:
    # Drop in reverse dependency order.
    op.drop_index("idx_biometric_match_decided_at", table_name="biometric_match")
    op.drop_index("idx_biometric_match_doc_id", table_name="biometric_match")
    op.drop_index("idx_biometric_match_tenant_customer", table_name="biometric_match")
    op.drop_table("biometric_match")

    op.drop_index("idx_biometric_encodings_expires_at", table_name="biometric_encodings")
    op.drop_index("idx_biometric_encodings_tenant_sha256", table_name="biometric_encodings")
    op.drop_table("biometric_encodings")

    op.drop_index("idx_biometric_consent_customer", table_name="biometric_consent")
    op.drop_index("idx_biometric_consent_tenant", table_name="biometric_consent")
    op.drop_table("biometric_consent")

    # Attempt to drop tenant_settings columns (graceful — SQLite doesn't support
    # DROP COLUMN in older versions; this will be a no-op there).
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if "tenant_settings" in inspector.get_table_names():
        for col in ("face_match_threshold", "face_encoding_retention_days", "biometric_consent_required"):
            existing_cols = [c["name"] for c in inspector.get_columns("tenant_settings")]
            if col in existing_cols:
                try:
                    op.drop_column("tenant_settings", col)
                except Exception:
                    pass

"""envelope encryption + voice enrollment + ZK proofs

Revision ID: 0012_e2ee_voice_zk
Revises: 0011_oidc
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_e2ee_voice_zk"
down_revision = "0011_oidc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customer_deks",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_cid", sa.String(64), unique=True, index=True),
        sa.Column("wrapped_dek", sa.Text),
        sa.Column("kms_key_id", sa.String(128)),
        sa.Column("algorithm", sa.String(32), server_default="AES-256-GCM"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("rotated_at", sa.DateTime),
    )
    op.create_table(
        "voice_enrollments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_sub", sa.String(128), index=True),
        sa.Column("customer_cid", sa.String(64), index=True),
        sa.Column("embedding", sa.Text),
        sa.Column("samples", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime),
    )
    op.create_table(
        "zk_proofs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_cid", sa.String(64), index=True),
        sa.Column("claim", sa.String(64)),
        sa.Column("issued_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime),
        sa.Column("commitment", sa.String(128)),
        sa.Column("signature", sa.Text),
        sa.Column("revoked", sa.Integer, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("zk_proofs")
    op.drop_table("voice_enrollments")
    op.drop_table("customer_deks")

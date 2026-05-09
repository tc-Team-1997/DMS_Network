"""SOX-1: stepup_used_assertions replay-prevention table.

Creates the ``stepup_used_assertions`` table used by the Wave C
POST /api/v1/stepup/verify endpoint to enforce one-use-per-TTL semantics
on WebAuthn assertion_ids, preventing replay attacks.

assertion_id is the PRIMARY KEY so the uniqueness constraint is enforced
at the DB layer — a duplicate insert raises IntegrityError before the
service layer can return a false-positive verified=True.

Revision ID  : 0043_stepup_validation
Revises      : 0037_users_v2
Create Date  : 2026-05-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0043_stepup_validation"
down_revision = "0042_notifications_feed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stepup_used_assertions",
        sa.Column("assertion_id", sa.String(256), primary_key=True),
        sa.Column("user_sub", sa.String(128), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False, server_default="nbe"),
        sa.Column("used_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_stepup_used_assertions_user_sub",
        "stepup_used_assertions",
        ["user_sub"],
    )
    op.create_index(
        "ix_stepup_used_assertions_tenant_id",
        "stepup_used_assertions",
        ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_stepup_used_assertions_tenant_id", table_name="stepup_used_assertions")
    op.drop_index("ix_stepup_used_assertions_user_sub", table_name="stepup_used_assertions")
    op.drop_table("stepup_used_assertions")

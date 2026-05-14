"""dsar_requests — additive columns for Plan 3 (Wave-E1)

Revision ID: 0045_dsar_requests_extend
Revises: 0044_workflow_audit_unification
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0045_dsar_requests_extend"
down_revision = "0044_workflow_audit_unification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("dsar_requests") as batch:
        batch.add_column(sa.Column("dpo_user_id", sa.Integer, nullable=True))
        batch.add_column(sa.Column("audit_chain_head", sa.String(128), nullable=True))
        batch.add_column(sa.Column("inventory_snapshot", sa.Text, nullable=True))
        batch.add_column(sa.Column("branch_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("axis", sa.String(32), nullable=True))
    op.create_index("idx_dsar_requests_branch", "dsar_requests", ["branch_id"])


def downgrade() -> None:
    op.drop_index("idx_dsar_requests_branch", table_name="dsar_requests")
    with op.batch_alter_table("dsar_requests") as batch:
        batch.drop_column("axis")
        batch.drop_column("branch_id")
        batch.drop_column("inventory_snapshot")
        batch.drop_column("audit_chain_head")
        batch.drop_column("dpo_user_id")

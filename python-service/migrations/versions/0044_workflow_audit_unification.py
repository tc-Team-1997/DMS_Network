"""SOX-2: workflow audit trail unification columns.

Adds ``reason_code`` and ``assertion_id`` columns to ``workflow_steps``
so the Python side records the full SOX-audit context (not just the state
machine step) when Node calls the two-phase advance endpoint.

The ``python_step_id`` column is added on the Node SQLite side by a separate
db/seed migration (see db/schema.sql Migration 0032 comment block); this
Python migration only owns the Python-side schema.

Revision ID  : 0044_workflow_audit_unification
Revises      : 0043_stepup_validation
Create Date  : 2026-05-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0044_workflow_audit_unification"
down_revision = "0043_stepup_validation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workflow_steps") as batch_op:
        batch_op.add_column(sa.Column("reason_code", sa.String(128), nullable=True))
        batch_op.add_column(sa.Column("assertion_id", sa.String(256), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("workflow_steps") as batch_op:
        batch_op.drop_column("assertion_id")
        batch_op.drop_column("reason_code")

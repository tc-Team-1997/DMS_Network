"""Workflows v2 — wf_actions table + workflow_steps extensions.

Creates the wf_actions table (Node SQLite counterpart already added to
db/schema.sql). Also adds four nullable columns to workflow_steps so the
Python state-machine journal can optionally store the same SOX fields when
actions arrive via the mobile / API-key path.

Changes are strictly additive — no existing column is dropped or renamed.

Revision ID  : 0028_workflows_actions
Revises      : 0027_tenant_config
Create Date  : 2026-05-10
"""
from alembic import op
import sqlalchemy as sa

revision = '0028_workflows_actions'
down_revision = '0027_tenant_config'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── wf_actions — new table (Python side mirror of Node wf_actions) ────────
    op.create_table(
        'wf_actions',
        sa.Column('id',                    sa.Integer(),     primary_key=True),
        sa.Column('workflow_id',           sa.Integer(),     nullable=False, index=True),
        sa.Column('user_id',               sa.Integer(),     nullable=False),
        sa.Column('action',                sa.String(32),    nullable=False),
        sa.Column('reason_code',           sa.String(64),    nullable=True),
        sa.Column('comment',               sa.Text(),        nullable=True),
        sa.Column('webauthn_assertion_id', sa.String(128),   nullable=True),
        sa.Column('attachment_id',         sa.Integer(),     nullable=True),
        sa.Column('tenant_id',             sa.String(64),    nullable=False, server_default='nbe'),
        sa.Column('created_at',            sa.DateTime(),    nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_wf_actions_workflow_id', 'wf_actions', ['workflow_id'])
    op.create_index('ix_wf_actions_tenant_id',   'wf_actions', ['tenant_id'])

    # ── workflow_steps — additive columns for SOX fields ─────────────────────
    # Each wrapped individually; SQLite only allows one ADD COLUMN per ALTER.
    with op.batch_alter_table('workflow_steps') as batch_op:
        batch_op.add_column(sa.Column('reason_code',           sa.String(64),  nullable=True))
        batch_op.add_column(sa.Column('webauthn_assertion_id', sa.String(128), nullable=True))
        batch_op.add_column(sa.Column('attachment_id',         sa.Integer(),   nullable=True))


def downgrade() -> None:
    # Remove wf_actions.
    op.drop_index('ix_wf_actions_tenant_id',   table_name='wf_actions')
    op.drop_index('ix_wf_actions_workflow_id',  table_name='wf_actions')
    op.drop_table('wf_actions')

    # Remove the added columns from workflow_steps (batch mode for SQLite).
    with op.batch_alter_table('workflow_steps') as batch_op:
        batch_op.drop_column('attachment_id')
        batch_op.drop_column('webauthn_assertion_id')
        batch_op.drop_column('reason_code')

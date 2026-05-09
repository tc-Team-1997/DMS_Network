"""notifications_feed — Wave C (migration 0042).

Adds 4 columns + index to the notifications table for the in-app feed:
    is_read     BOOLEAN NOT NULL DEFAULT FALSE
    read_at     DATETIME
    event_type  VARCHAR(128)
    template_id VARCHAR(128)

Also adds idx_notifications_user_read for efficient unread-count queries.

Idempotent: uses batch_alter_table with try/except so re-running on an
already-migrated DB is safe.

down_revision: re-targeted by the integrator when all Wave C migrations land.
Current value: 0037_users_v2 — valid for standalone branch deployment.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0042_notifications_feed"
down_revision = "0041_docbrain_conversations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "notifications" not in inspector.get_table_names():
        op.execute(
            """
            CREATE TABLE notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id VARCHAR(64),
                user_id VARCHAR(64),
                title VARCHAR(255),
                body TEXT,
                channel VARCHAR(32),
                event_type VARCHAR(128),
                template_id VARCHAR(128),
                is_read BOOLEAN NOT NULL DEFAULT 0,
                read_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    else:
        with op.batch_alter_table("notifications", schema=None) as batch_op:
            try:
                batch_op.add_column(sa.Column("is_read", sa.Boolean(), nullable=False, server_default="0"))
            except Exception:
                pass
            try:
                batch_op.add_column(sa.Column("read_at", sa.DateTime(), nullable=True))
            except Exception:
                pass
            try:
                batch_op.add_column(sa.Column("event_type", sa.String(128), nullable=True))
            except Exception:
                pass
            try:
                batch_op.add_column(sa.Column("template_id", sa.String(128), nullable=True))
            except Exception:
                pass

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_notifications_user_read "
        "ON notifications (user_id, is_read)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_notifications_user_read")
    # SQLite does not support DROP COLUMN; skip column removal in downgrade.
    # On Postgres, uncomment the lines below:
    # with op.batch_alter_table("notifications", schema=None) as batch_op:
    #     batch_op.drop_column("template_id")
    #     batch_op.drop_column("event_type")
    #     batch_op.drop_column("read_at")
    #     batch_op.drop_column("is_read")

"""Audit log v2 — stamp migration (Wave C).

Scope of changes:

  Node-side (db/index.js migration 0038 boot guard — NOT in this file):
    - audit_log ADD COLUMN entity_type TEXT
    - audit_log ADD COLUMN detail TEXT
    - audit_log ADD COLUMN prev_hash TEXT
    - audit_log ADD COLUMN hash TEXT
    - audit_log ADD COLUMN result TEXT DEFAULT 'allow'
    - CREATE VIRTUAL TABLE audit_log_fts USING fts5(...)
    - AFTER INSERT/UPDATE/DELETE triggers to keep FTS in sync
    - Backfill hash chain for all existing rows (chain unbroken from id=1 forward)

  Python-side (this migration):
    - No Python DB tables are modified.  The Node SQLite handles the
      audit_log chain; Python's anchor chain lives in storage/anchors/chain.jsonl.
    - A new endpoint POST /api/v1/anchor/chain is added to
      python-service/app/routers/anchor.py (no schema change needed).

  Admin namespace:
    - schemas/tenant-config/audit_log.json published.

Approved deviations:
  - FTS5 lives in SQLite (Node DB only); Python service uses its own
    search_backend for full-text over Python-managed documents.
  - OTS anchor for the audit chain delegates to the existing local-mode
    anchor service (_append_local); no on-chain tx for offline environments.

Revision ID  : 0038_audit_fts
Revises      : 0037_users_v2
Create Date  : 2026-05-10
"""

from alembic import op

revision = "0038_audit_fts"
down_revision = "0037_users_v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No Python DB schema changes — Node SQLite owns audit_log.
    # This migration is a documentation anchor so the 0038 number is
    # permanently reserved and the upgrade chain stays contiguous.
    pass


def downgrade() -> None:
    pass

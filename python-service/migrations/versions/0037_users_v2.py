"""Users v2 — stamp migration for Node-side tables + WebAuthnCredential index.

Wave B — Users v2 scope:

  Node-side (db/seed.js migration 0031, not in this file):
    - users.password TEXT NOT NULL → TEXT nullable
    - users.mfa_phone TEXT added
    - CREATE TABLE user_invites (magic-link invite tokens, 7-day TTL)
    - CREATE TABLE saml_idps (IdP metadata, claim_map_json, enforce_only)
    - tenant_config seeds: auth.*, rbac.* namespaces

  Python-side (this migration):
    - Adds a composite index on webauthn_credentials(user_sub, credential_id)
      to speed up the new users_admin router lookups.
    - No new tables needed: user_invites + saml_idps live in Node SQLite.
      Python accesses WebAuthn credentials from its own DB via users_admin router.

  Approved deviations:
    - WebAuthn enrollment UI disabled in Wave B (Wave C scope).
    - SAML test-SSO returns request XML only; no live IdP roundtrip.
    - SMS factor stores phone + enable/disable; no OTP send flow.

Revision ID  : 0037_users_v2
Revises      : 0036_legal_holds_dedup_cleanup
Create Date  : 2026-05-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0037_users_v2"
down_revision = "0036_legal_holds_dedup_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add composite index on webauthn_credentials for users_admin router.
    # op.create_index is idempotent-safe via if_not_exists=True.
    with op.batch_alter_table("webauthn_credentials") as batch_op:
        batch_op.create_index(
            "ix_webauthn_credentials_user_sub_cred_id",
            ["user_sub", "credential_id"],
            unique=False,
            if_not_exists=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("webauthn_credentials") as batch_op:
        batch_op.drop_index("ix_webauthn_credentials_user_sub_cred_id")

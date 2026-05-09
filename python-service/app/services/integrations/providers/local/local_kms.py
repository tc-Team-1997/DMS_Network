"""LocalKms — delegates to services/encryption.py (AES-256-GCM envelope).

key_id is an opaque caller-supplied identifier. LocalKms uses it as the
per-DEK lookup index passed to encryption.py's DEK management functions
(get_or_create_dek / plaintext_dek). Future providers (AWS KMS, HSM) interpret
key_id according to their own scheme (ARN, PKCS#11 label, etc.).

Requires a db Session; when db is None the provider raises RuntimeError.
The db is injected by callers that retrieve the provider from the registry.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging

from ...providers_base import KmsProvider

log = logging.getLogger(__name__)


class LocalKms(KmsProvider):
    """Envelope-encryption KMS backed by AES-256-GCM + per-customer DEKs.

    Delegates to app.services.encryption which implements:
      - DEK generation and storage (wrapped by LOCAL_KEK_HEX or AWS/Azure KMS)
      - AES-256-GCM encrypt_bytes / decrypt_bytes

    key_id is an opaque caller-supplied identifier used as the per-DEK lookup
    index. Callers that happen to pass a customer CID as key_id get per-customer
    DEK semantics automatically (the encryption service uses CID as its DEK
    lookup key). Other callers may pass any stable string identifier.

    db must be injected at construction; raise RuntimeError if absent.
    """

    def __init__(self, db=None, tenant_id: str = "default") -> None:
        self._db = db
        self._tenant_id = tenant_id

    def _require_db(self):
        if self._db is None:
            raise RuntimeError(
                "LocalKms requires a database session (db) to look up DEKs. "
                "Inject it via LocalKms(db=session) or use the registry with "
                "a db-aware resolve() call."
            )
        return self._db

    def encrypt(self, plaintext: bytes, *, key_id: str) -> bytes:
        """Encrypt *plaintext* using the DEK associated with *key_id*.

        key_id is used opaquely as the DEK lookup / derivation index in the
        encryption service. AES-256-GCM with a fresh 12-byte nonce; output
        is prefixed with the 'NBE1' envelope magic bytes.
        """
        db = self._require_db()
        try:
            from app.services.encryption import plaintext_dek, encrypt_bytes
        except ImportError as exc:
            raise RuntimeError("encryption service is not available") from exc
        dek = plaintext_dek(db, key_id)
        return encrypt_bytes(plaintext, dek)

    def decrypt(self, ciphertext: bytes, *, key_id: str) -> bytes:
        """Decrypt *ciphertext* using the DEK associated with *key_id*.

        key_id must match the value used during encrypt() so the correct DEK
        is retrieved from the wrapped-DEK store.
        """
        db = self._require_db()
        try:
            from app.services.encryption import plaintext_dek, decrypt_bytes
        except ImportError as exc:
            raise RuntimeError("encryption service is not available") from exc
        dek = plaintext_dek(db, key_id)
        return decrypt_bytes(ciphertext, dek)

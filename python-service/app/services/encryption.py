"""Envelope encryption at rest, per customer.

Pattern:
  - Each customer CID has a 256-bit Data Encryption Key (DEK) generated locally.
  - DEK is wrapped by a Key Encryption Key (KEK) in a KMS. Only the wrapped DEK is
    persisted (`customer_deks.wrapped_dek`).
  - To read/write a file: unwrap the DEK (a KMS round-trip) → AES-256-GCM.

KMS backends (auto-selected by env):
  - AWS KMS (`AWS_KMS_KEY_ID`) via boto3
  - Azure Key Vault (`AZURE_KEYVAULT_URL` + key `AZURE_KEY_NAME`)
  - Local master key (dev only; `LOCAL_KEK_HEX` = 64-char hex)

Rotating a DEK: unwrap → wrap with a new KMS key version → re-encrypt files.
Rotating the KEK: done inside the KMS; wrapped DEKs stay valid until you re-wrap.

Cryptoshred (GDPR Art-17):
  - cryptoshred() sets wrapped_dek to _SHREDDED_DEK and kms_key_id to _SHREDDED_KID.
  - All subsequent unwrap_dek() / plaintext_dek() calls raise CryptoshreddedError.
  - The ciphertext blobs on disk are permanently unreadable — no key exists.
  - The audit trail (dsar_requests, audit_log) is preserved as required by
    banking regulators (accountability obligations survive erasure).
"""
from __future__ import annotations
import base64
import os
import secrets
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from ..models import CustomerDek


AWS_KMS_KEY_ID = os.environ.get("AWS_KMS_KEY_ID", "").strip()
AZURE_KEYVAULT_URL = os.environ.get("AZURE_KEYVAULT_URL", "").strip()
AZURE_KEY_NAME = os.environ.get("AZURE_KEY_NAME", "").strip()
LOCAL_KEK_HEX = os.environ.get("LOCAL_KEK_HEX", "").strip()

# Sentinel values written into customer_deks by cryptoshred().
# Checked at the top of every unwrap path so callers get a typed, readable error.
_SHREDDED_DEK = "CRYPTOSHREDDED"
_SHREDDED_KID = "SHREDDED"


class CryptoshreddedError(Exception):
    """Raised when code attempts to unwrap a DEK that has been cryptoshredded.

    This is an explicit, typed signal so that callers (and engineers reading
    stack traces) immediately see the root cause instead of a generic
    decoding error.  The customer's data is permanently unreadable by design
    — this is the correct GDPR Art-17 cryptoshred outcome.  The audit trail
    in dsar_requests / audit_log is preserved as required.
    """
    def __init__(self, customer_cid: str) -> None:
        self.customer_cid = customer_cid
        super().__init__(
            f"DEK for customer '{customer_cid}' has been cryptoshredded. "
            "Documents are permanently unreadable (GDPR Art-17 compliant). "
            "Audit trail is preserved in dsar_requests."
        )


def _b64(b: bytes) -> str: return base64.b64encode(b).decode()
def _unb64(s: str) -> bytes: return base64.b64decode(s.encode())


def _check_shredded(wrapped_dek: Optional[str], kms_key_id: Optional[str],
                    customer_cid: str) -> None:
    """Raise CryptoshreddedError if either sentinel is present."""
    if wrapped_dek == _SHREDDED_DEK or kms_key_id == _SHREDDED_KID:
        raise CryptoshreddedError(customer_cid)


# ---------- KEK operations (wrap / unwrap) ----------
def _kms_backend() -> str:
    if AWS_KMS_KEY_ID: return "aws"
    if AZURE_KEYVAULT_URL and AZURE_KEY_NAME: return "azure"
    if LOCAL_KEK_HEX: return "local"
    return "none"


def wrap_dek(dek: bytes) -> tuple[str, str]:
    """Return (wrapped_b64, kms_key_id_label)."""
    backend = _kms_backend()
    if backend == "aws":
        import boto3
        kms = boto3.client("kms")
        r = kms.encrypt(KeyId=AWS_KMS_KEY_ID, Plaintext=dek)
        return _b64(r["CiphertextBlob"]), AWS_KMS_KEY_ID
    if backend == "azure":
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.keys.crypto import CryptographyClient, KeyWrapAlgorithm
        from azure.keyvault.keys import KeyClient
        cred = DefaultAzureCredential()
        kc = KeyClient(vault_url=AZURE_KEYVAULT_URL, credential=cred)
        key = kc.get_key(AZURE_KEY_NAME)
        crypto = CryptographyClient(key.id, credential=cred)
        r = crypto.wrap_key(KeyWrapAlgorithm.rsa_oaep_256, dek)
        return _b64(r.encrypted_key), key.id
    if backend == "local":
        return _local_wrap(dek), "local-kek"
    # None → store raw (dev fallback). Document this loudly in the field.
    return _b64(dek), "NO-KMS-DEV-ONLY"


def unwrap_dek(wrapped_b64: str, kms_key_id: str, customer_cid: str = "unknown") -> bytes:
    """Unwrap a DEK.  Raises CryptoshreddedError if sentinel values are present."""
    _check_shredded(wrapped_b64, kms_key_id, customer_cid)
    backend = _kms_backend()
    if backend == "aws":
        import boto3
        kms = boto3.client("kms")
        r = kms.decrypt(CiphertextBlob=_unb64(wrapped_b64))
        return r["Plaintext"]
    if backend == "azure":
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.keys.crypto import CryptographyClient, KeyWrapAlgorithm
        cred = DefaultAzureCredential()
        crypto = CryptographyClient(kms_key_id, credential=cred)
        r = crypto.unwrap_key(KeyWrapAlgorithm.rsa_oaep_256, _unb64(wrapped_b64))
        return r.key
    if backend == "local":
        return _local_unwrap(wrapped_b64)
    return _unb64(wrapped_b64)


def _local_wrap(dek: bytes) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    kek = bytes.fromhex(LOCAL_KEK_HEX)
    nonce = secrets.token_bytes(12)
    ct = AESGCM(kek).encrypt(nonce, dek, b"dek")
    return _b64(nonce + ct)


def _local_unwrap(wrapped_b64: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    kek = bytes.fromhex(LOCAL_KEK_HEX)
    raw = _unb64(wrapped_b64)
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(kek).decrypt(nonce, ct, b"dek")


# ---------- Customer DEK management ----------
def get_or_create_dek(db: Session, customer_cid: str) -> CustomerDek:
    row = db.query(CustomerDek).filter(CustomerDek.customer_cid == customer_cid).first()
    if row:
        return row
    dek = secrets.token_bytes(32)
    wrapped, kid = wrap_dek(dek)
    row = CustomerDek(customer_cid=customer_cid, wrapped_dek=wrapped, kms_key_id=kid)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def plaintext_dek(db: Session, customer_cid: str) -> bytes:
    row = get_or_create_dek(db, customer_cid)
    # Pass customer_cid so CryptoshreddedError includes it in the message.
    return unwrap_dek(row.wrapped_dek, row.kms_key_id, customer_cid=customer_cid)


def rotate_dek(db: Session, customer_cid: str) -> dict:
    """Generate a fresh DEK; caller is responsible for re-encrypting the blobs."""
    row = db.query(CustomerDek).filter(CustomerDek.customer_cid == customer_cid).first()
    new_dek = secrets.token_bytes(32)
    wrapped, kid = wrap_dek(new_dek)
    if row:
        row.wrapped_dek = wrapped
        row.kms_key_id = kid
        row.rotated_at = datetime.utcnow()
    else:
        row = CustomerDek(customer_cid=customer_cid, wrapped_dek=wrapped, kms_key_id=kid)
        db.add(row)
    db.commit()
    return {"customer_cid": customer_cid, "kms_key_id": kid, "rotated_at": datetime.utcnow().isoformat()}


def cryptoshred(db: Session, customer_cid: str) -> dict:
    """GDPR Art-17 cryptoshred: destroy the DEK so encrypted documents are permanently unreadable.

    Semantics:
      - Sets wrapped_dek = _SHREDDED_DEK, kms_key_id = _SHREDDED_KID.
      - All subsequent plaintext_dek() / unwrap_dek() calls will raise CryptoshreddedError.
      - Encrypted blobs on disk become permanently unreadable ciphertext.
      - This function does NOT delete blobs or audit rows (accountability survives erasure).
      - Callers must write an AuditLog / dsar_requests row BEFORE calling this function.

    Returns a receipt dict that the caller should persist in dsar_requests.signed_receipt.
    """
    row = db.query(CustomerDek).filter(CustomerDek.customer_cid == customer_cid).first()
    shredded_at = datetime.utcnow().isoformat() + "Z"
    if row:
        row.wrapped_dek = _SHREDDED_DEK
        row.kms_key_id = _SHREDDED_KID
        row.rotated_at = datetime.utcnow()
        db.commit()
    # If no DEK row exists, the customer had no encrypted data — nothing to shred.
    return {
        "customer_cid": customer_cid,
        "action": "cryptoshred",
        "dek_destroyed": row is not None,
        "shredded_at": shredded_at,
        "semantic": "DEK destroyed; ciphertext on disk is permanently unreadable; audit trail preserved",
    }


# ---------- File encrypt / decrypt ----------
def encrypt_bytes(data: bytes, dek: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    ct = AESGCM(dek).encrypt(nonce, data, b"doc")
    return b"NBE1" + nonce + ct


def decrypt_bytes(blob: bytes, dek: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not blob.startswith(b"NBE1"):
        raise ValueError("not an NBE envelope")
    raw = blob[4:]
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(dek).decrypt(nonce, ct, b"doc")


def encrypt_file(db: Session, in_path: str, out_path: str, customer_cid: str) -> str:
    with open(in_path, "rb") as f:
        data = f.read()
    ct = encrypt_bytes(data, plaintext_dek(db, customer_cid))
    with open(out_path, "wb") as f:
        f.write(ct)
    return out_path


def decrypt_file(db: Session, in_path: str, out_path: str, customer_cid: str) -> str:
    with open(in_path, "rb") as f:
        ct = f.read()
    pt = decrypt_bytes(ct, plaintext_dek(db, customer_cid))
    with open(out_path, "wb") as f:
        f.write(pt)
    return out_path


def backend() -> str:
    return _kms_backend()

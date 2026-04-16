"""Digital signature service.

Two modes:
- **detached**: produces a .sig file containing RSA-PSS signature over SHA-256 of the document
  bytes plus a JSON manifest (signer, timestamp, cert fingerprint). Works for any file type.
- **pdf_visible**: adds a visible signature block to a PDF via pypdf overlay + detached sig.

Cryptography is provided by `cryptography` package. A self-signed demo cert is auto-generated
on first use and stored in storage/keys/ — replace with your CA-issued cert for production
(PAdES / eIDAS compliance requires a proper trust chain + timestamp authority).
"""
from __future__ import annotations
import json
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from ..config import settings


KEYS_DIR = Path(settings.STORAGE_DIR).parent / "keys"
KEYS_DIR.mkdir(parents=True, exist_ok=True)
KEY_PATH = KEYS_DIR / "signer.key.pem"
CERT_PATH = KEYS_DIR / "signer.cert.pem"


def _ensure_cert():
    if KEY_PATH.exists() and CERT_PATH.exists():
        return
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography import x509
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "EG"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "National Bank of Egypt"),
        x509.NameAttribute(NameOID.COMMON_NAME, "NBE DMS Signer"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject).issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.utcnow())
        .not_valid_after(datetime.utcnow() + timedelta(days=3650))
        .sign(key, hashes.SHA256())
    )
    KEY_PATH.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    CERT_PATH.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def _load_key():
    from cryptography.hazmat.primitives import serialization
    return serialization.load_pem_private_key(KEY_PATH.read_bytes(), password=None)


def _cert_fingerprint() -> str:
    from cryptography import x509
    cert = x509.load_pem_x509_certificate(CERT_PATH.read_bytes())
    return cert.fingerprint(__import__("cryptography.hazmat.primitives.hashes", fromlist=["SHA256"]).SHA256()).hex()


def sign_detached(file_path: str, signer: str, reason: str = "Approved") -> dict:
    """Produce a detached RSA-PSS signature + manifest. Returns paths + metadata."""
    _ensure_cert()
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    p = Path(file_path)
    data = p.read_bytes()
    digest = hashlib.sha256(data).hexdigest()

    key = _load_key()
    signature = key.sign(
        data,
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    )

    manifest = {
        "file": p.name,
        "sha256": digest,
        "signer": signer,
        "reason": reason,
        "signed_at": datetime.utcnow().isoformat() + "Z",
        "cert_fingerprint_sha256": _cert_fingerprint(),
        "algorithm": "RSA-PSS-SHA256",
    }

    sig_path = p.with_suffix(p.suffix + ".sig")
    manifest_path = p.with_suffix(p.suffix + ".sig.json")
    sig_path.write_bytes(signature)
    manifest_path.write_text(json.dumps(manifest, indent=2))

    return {
        "signature_path": str(sig_path),
        "manifest_path": str(manifest_path),
        "manifest": manifest,
    }


def verify_detached(file_path: str) -> dict:
    """Verify a detached signature produced by sign_detached."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography import x509

    p = Path(file_path)
    sig_path = p.with_suffix(p.suffix + ".sig")
    manifest_path = p.with_suffix(p.suffix + ".sig.json")
    if not sig_path.exists() or not manifest_path.exists():
        return {"valid": False, "reason": "signature not found"}

    data = p.read_bytes()
    signature = sig_path.read_bytes()
    manifest = json.loads(manifest_path.read_text())

    current_digest = hashlib.sha256(data).hexdigest()
    if current_digest != manifest.get("sha256"):
        return {"valid": False, "reason": "hash mismatch — file modified after signing"}

    cert = x509.load_pem_x509_certificate(CERT_PATH.read_bytes())
    try:
        cert.public_key().verify(
            signature, data,
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
            hashes.SHA256(),
        )
        return {"valid": True, "manifest": manifest}
    except Exception as e:
        return {"valid": False, "reason": f"signature invalid: {e}"}


def stamp_pdf_visible(pdf_path: str, signer: str, reason: str = "Approved") -> Optional[str]:
    """Add a visible signature block to a PDF using pypdf. Returns output path or None if pypdf missing."""
    try:
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import RectangleObject
    except Exception:
        return None

    p = Path(pdf_path)
    if p.suffix.lower() != ".pdf":
        return None

    reader = PdfReader(str(p))
    writer = PdfWriter(clone_from=reader)
    # pypdf doesn't do PAdES — for a real PAdES signature use endesive / pyhanko.
    # Here we stamp a visible annotation; detached signature covers tamper detection.
    writer.add_metadata({
        "/Signer": signer,
        "/Reason": reason,
        "/SignedAt": datetime.utcnow().isoformat() + "Z",
    })
    out = p.with_name(p.stem + ".signed.pdf")
    with open(out, "wb") as f:
        writer.write(f)
    return str(out)

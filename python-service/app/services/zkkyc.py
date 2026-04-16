"""Selective-disclosure KYC proofs.

"True" ZK (zk-SNARKs / BBS+) requires a heavy toolchain; for most banking use-cases
a **bank-signed verifiable claim** is equivalent in outcome:

  1. Customer asks for a proof of some claim (e.g. `kyc_valid`, `age_over_18`,
     `resident_egypt`) — we check the underlying documents, then issue a
     commitment + signature bound to:
        commitment = SHA256(customer_cid || claim || issued_at || nonce)
  2. The customer hands the proof token to a third party (another bank, a fintech,
     a landlord). The verifier POSTs it to /api/v1/zk/verify — we return
     `{valid: true, claim: "kyc_valid", ...}` without ever revealing name / DOB / etc.
  3. Revocation is a DB flag — so short TTLs plus a revocation check make this
     a practical "bank-as-issuer, bank-as-verifier" consent-minimized channel.

Upgrading to true ZK (BBS+ with verifiable credentials) is a drop-in replacement:
swap `_commit()` with a BBS+ commit and `_sign()` with a BBS+ signature.
"""
from __future__ import annotations
import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Document, EFormSubmission, ZkProof


KEYS_DIR = Path(settings.STORAGE_DIR).parent / "keys"
KEYS_DIR.mkdir(parents=True, exist_ok=True)
ZK_PRIV = KEYS_DIR / "zk_issuer.key.pem"
ZK_PUB = KEYS_DIR / "zk_issuer.pub.pem"


def _ensure_keys():
    if ZK_PRIV.exists() and ZK_PUB.exists():
        return
    from cryptography.hazmat.primitives.asymmetric import ed25519
    from cryptography.hazmat.primitives import serialization

    key = ed25519.Ed25519PrivateKey.generate()
    ZK_PRIV.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    ZK_PUB.write_bytes(key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ))


def _sign(data: bytes) -> str:
    from cryptography.hazmat.primitives import serialization
    _ensure_keys()
    priv = serialization.load_pem_private_key(ZK_PRIV.read_bytes(), password=None)
    return base64.b64encode(priv.sign(data)).decode()


def _verify_sig(data: bytes, sig_b64: str) -> bool:
    from cryptography.hazmat.primitives import serialization
    _ensure_keys()
    pub = serialization.load_pem_public_key(ZK_PUB.read_bytes())
    try:
        pub.verify(base64.b64decode(sig_b64), data)
        return True
    except Exception:
        return False


def _commit(customer_cid: str, claim: str, issued_at: str, nonce: str) -> str:
    return hashlib.sha256(f"{customer_cid}|{claim}|{issued_at}|{nonce}".encode()).hexdigest()


# ---------- Claim evaluators ----------
def _claim_kyc_valid(db: Session, customer_cid: str) -> bool:
    today = datetime.utcnow().date().isoformat()
    n_valid = (
        db.query(Document)
        .filter(Document.customer_cid == customer_cid,
                Document.doc_type.in_(["passport", "national_id"]),
                Document.status.in_(["indexed", "archived", "signed"]))
        .filter((Document.expiry_date == None) | (Document.expiry_date >= today))  # noqa: E711
        .count()
    )
    return n_valid > 0


def _claim_age_over_18(db: Session, customer_cid: str) -> bool:
    # Scan e-form submissions for a DOB field; 18y cut-off.
    subs = db.query(EFormSubmission).filter(EFormSubmission.customer_cid == customer_cid).all()
    cutoff = (datetime.utcnow().replace(year=datetime.utcnow().year - 18)).date()
    for s in subs:
        try:
            data = json.loads(s.data_json or "{}")
        except Exception:
            continue
        dob = data.get("dob") or data.get("date_of_birth")
        if not dob:
            continue
        try:
            d = datetime.strptime(dob, "%Y-%m-%d").date()
            if d <= cutoff:
                return True
        except Exception:
            continue
    return False


def _claim_resident_egypt(db: Session, customer_cid: str) -> bool:
    subs = db.query(EFormSubmission).filter(EFormSubmission.customer_cid == customer_cid).all()
    for s in subs:
        try:
            data = json.loads(s.data_json or "{}")
        except Exception:
            continue
        ctry = str(data.get("country") or data.get("residence_country") or "").lower()
        if ctry in ("eg", "egypt", "مصر"):
            return True
    return False


CLAIMS = {
    "kyc_valid": _claim_kyc_valid,
    "age_over_18": _claim_age_over_18,
    "resident_egypt": _claim_resident_egypt,
}


# ---------- Issue / verify ----------
def issue(db: Session, customer_cid: str, claim: str, ttl_days: int = 90) -> dict:
    if claim not in CLAIMS:
        raise ValueError(f"unknown claim: {claim}")
    if not CLAIMS[claim](db, customer_cid):
        raise ValueError(f"claim '{claim}' does not hold for {customer_cid}")

    now = datetime.utcnow()
    issued_at = now.isoformat() + "Z"
    nonce = secrets.token_hex(16)
    commitment = _commit(customer_cid, claim, issued_at, nonce)
    exp = now + timedelta(days=ttl_days)

    payload = {
        "iss": "NBE-DMS", "claim": claim,
        "commitment": commitment,
        "issued_at": issued_at,
        "expires_at": exp.isoformat() + "Z",
    }
    sig = _sign(json.dumps(payload, sort_keys=True).encode())

    row = ZkProof(customer_cid=customer_cid, claim=claim,
                  expires_at=exp, commitment=commitment,
                  signature=sig)
    db.add(row)
    db.commit()

    # The *customer* holds (proof_token, nonce). Verifier only sees proof_token.
    token = base64.urlsafe_b64encode(
        json.dumps({"payload": payload, "signature": sig}).encode()
    ).decode()

    return {
        "proof_token": token,
        "nonce": nonce,  # given to the customer privately
        "claim": claim,
        "expires_at": payload["expires_at"],
    }


def verify_proof(db: Session, proof_token: str, customer_cid: Optional[str] = None,
                 nonce: Optional[str] = None) -> dict:
    try:
        blob = json.loads(base64.urlsafe_b64decode(proof_token.encode()))
    except Exception:
        return {"valid": False, "reason": "malformed_token"}
    payload = blob.get("payload") or {}
    sig = blob.get("signature") or ""
    if not _verify_sig(json.dumps(payload, sort_keys=True).encode(), sig):
        return {"valid": False, "reason": "bad_signature"}
    try:
        exp = datetime.fromisoformat(payload["expires_at"].rstrip("Z"))
    except Exception:
        return {"valid": False, "reason": "bad_exp"}
    if exp < datetime.utcnow():
        return {"valid": False, "reason": "expired"}

    # Optional full-disclosure path: the customer shares (cid, nonce) to prove binding.
    if customer_cid and nonce:
        expected = _commit(customer_cid, payload["claim"],
                           payload["issued_at"], nonce)
        if expected != payload["commitment"]:
            return {"valid": False, "reason": "commitment_mismatch"}

    # Revocation check (by commitment).
    row = db.query(ZkProof).filter(ZkProof.commitment == payload["commitment"]).first()
    if row and row.revoked:
        return {"valid": False, "reason": "revoked"}

    return {"valid": True, "claim": payload["claim"],
            "issued_at": payload["issued_at"],
            "expires_at": payload["expires_at"]}


def revoke(db: Session, commitment: str) -> dict:
    row = db.query(ZkProof).filter(ZkProof.commitment == commitment).first()
    if not row:
        raise ValueError("not_found")
    row.revoked = 1
    db.commit()
    return {"commitment": commitment, "revoked": True}

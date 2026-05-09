"""Face Match KYC router — offline biometric verification (BHU-9, DPIA: high risk).

Endpoints:
  POST /api/v1/face-match              — match ID photo vs. live photo
  GET  /api/v1/face-match/consent-template — biometric consent text
  POST /api/v1/face-match/consent-token    — issue consent JWT
  GET  /api/v1/face-match/{match_id}       — retrieve stored decision (auditor)

Security non-negotiables:
  - Raw images are NEVER stored or logged. Only 128-dim float64 encodings persist.
  - Audit log records WHO, WHEN, WHICH customer — never image data or encoding.
  - Feature flag: FF_FACE_MATCH_KYC env var (default "off") → 501 when off.
  - Consent token (JWT) required per AC-7 (tenant_settings.biometric_consent_required).
  - Rate limit: 5 match calls per customer per day.
  - Tenant boundary enforced on every DB query.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import AuditLog, BiometricConsent, BiometricEncoding, BiometricMatch
from ..services.auth import Principal, current_principal, require

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/face-match", tags=["face-match-kyc"])

# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

_FF_KEY = "FF_FACE_MATCH_KYC"


def _feature_enabled() -> bool:
    return os.environ.get(_FF_KEY, "off").lower() in ("on", "true", "1", "yes")


def _require_feature() -> None:
    if not _feature_enabled():
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={
                "error": "feature_disabled",
                "message": (
                    f"Face Match KYC is disabled. Set {_FF_KEY}=on to enable."
                ),
            },
        )


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_MIME = {"image/jpeg", "image/png"}
CONSENT_TTL_MINUTES = 30
RATE_LIMIT_PER_DAY = 5

# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class FaceMatchResponse(BaseModel):
    match: bool
    distance: Optional[float]
    confidence: Optional[float]
    face_geometry_ok: bool
    id_photo_face_count: Optional[int] = None
    live_photo_face_count: Optional[int] = None
    detail: Optional[str] = None
    decision_at: str
    idempotency_key: Optional[str] = None


class ConsentTemplateResponse(BaseModel):
    consent_text: str
    tenant_id: str
    version: str
    language: str


class ConsentTokenRequest(BaseModel):
    customer_cid: str
    signed_at: str
    signature: Optional[str] = None


class ConsentTokenResponse(BaseModel):
    consent_token: str
    expires_at: str


class MatchRecordResponse(BaseModel):
    id: int
    customer_cid: str
    doc_id: Optional[int]
    match: bool
    distance: float
    confidence: float
    face_geometry_ok: bool
    id_photo_sha256: str
    live_photo_sha256: str
    decided_at: str
    decided_by: Optional[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _idempotency_key(tenant_id: str, customer_cid: str, id_sha: str, live_sha: str) -> str:
    raw = f"{tenant_id}:{customer_cid}:{id_sha}:{live_sha}"
    return hashlib.md5(raw.encode()).hexdigest()  # noqa: S324 — not cryptographic, just dedup key


def _issue_consent_jwt(tenant_id: str, customer_cid: str, signed_at: str) -> str:
    now = datetime.utcnow()
    exp = now + timedelta(minutes=CONSENT_TTL_MINUTES)
    payload = {
        "sub": customer_cid,
        "tenant": tenant_id,
        "purpose": "biometric_consent",
        "signed_at": signed_at,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def _decode_consent_jwt(token: str, tenant_id: str) -> dict:
    try:
        claims = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "consent_required",
                "message": f"Biometric consent token invalid or expired: {exc}",
            },
        )
    if claims.get("tenant") != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "consent_required",
                "message": "Consent token tenant mismatch",
            },
        )
    if claims.get("purpose") != "biometric_consent":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "consent_required",
                "message": "Token purpose is not biometric_consent",
            },
        )
    return claims


def _check_rate_limit(db: Session, tenant_id: str, customer_cid: str) -> None:
    """Raise 429 if customer has >= RATE_LIMIT_PER_DAY match calls today."""
    since = datetime.utcnow() - timedelta(days=1)
    count = (
        db.query(BiometricMatch)
        .filter(
            BiometricMatch.tenant_id == tenant_id,
            BiometricMatch.customer_cid == customer_cid,
            BiometricMatch.decided_at >= since,
        )
        .count()
    )
    if count >= RATE_LIMIT_PER_DAY:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "rate_limit_exceeded",
                "message": (
                    f"Too many verification attempts ({count} today). "
                    "Please try again tomorrow."
                ),
            },
        )


def _get_cached_encoding(
    db: Session, tenant_id: str, photo_sha256: str
) -> Optional[bytes]:
    """Return cached face encoding bytes, or None if no valid cache entry."""
    now = datetime.utcnow()
    row = (
        db.query(BiometricEncoding)
        .filter(
            BiometricEncoding.tenant_id == tenant_id,
            BiometricEncoding.photo_sha256 == photo_sha256,
            BiometricEncoding.expires_at > now,
        )
        .first()
    )
    return row.face_encoding if row else None


def _store_encoding(
    db: Session,
    tenant_id: str,
    photo_sha256: str,
    photo_type: str,
    encoding_bytes: bytes,
    geometry: Optional[dict],
    retention_days: int = 90,
) -> None:
    """Upsert a face encoding into biometric_encodings."""
    existing = (
        db.query(BiometricEncoding)
        .filter(
            BiometricEncoding.tenant_id == tenant_id,
            BiometricEncoding.photo_sha256 == photo_sha256,
        )
        .first()
    )
    if existing:
        existing.expires_at = datetime.utcnow() + timedelta(days=retention_days)
        existing.face_encoding = encoding_bytes
        existing.face_geometry = geometry
    else:
        row = BiometricEncoding(
            tenant_id=tenant_id,
            photo_sha256=photo_sha256,
            photo_type=photo_type,
            face_encoding=encoding_bytes,
            face_geometry=geometry,
            expires_at=datetime.utcnow() + timedelta(days=retention_days),
        )
        db.add(row)
    db.flush()


def _write_audit_log(
    db: Session,
    tenant_id: str,
    actor: str,
    customer_cid: str,
    distance: Optional[float],
    match_result: bool,
    threshold: float,
    face_geometry_ok: bool,
) -> None:
    """Write a BIOMETRIC_MATCH_DECIDED audit row. Never logs image data."""
    import json

    detail = json.dumps(
        {
            "customer_cid": customer_cid,
            "distance": distance,
            "match_result": match_result,
            "threshold_used": threshold,
            "face_geometry_ok": face_geometry_ok,
        }
    )
    row = AuditLog(
        tenant=tenant_id,
        actor=actor,
        action="BIOMETRIC_MATCH_DECIDED",
        resource_type="biometric_match",
        resource_id=customer_cid,
        detail=detail,
    )
    db.add(row)
    db.flush()


def _write_match_record(
    db: Session,
    tenant_id: str,
    customer_cid: str,
    id_sha: str,
    live_sha: str,
    distance: Optional[float],
    confidence: Optional[float],
    match_result: bool,
    face_geometry_ok: bool,
    threshold: float,
    decided_by: str,
    doc_id: Optional[int],
    consent_token_id: Optional[int],
) -> BiometricMatch:
    distance_val = distance if distance is not None else 0.0
    confidence_val = confidence if confidence is not None else 0.0
    row = BiometricMatch(
        tenant_id=tenant_id,
        customer_cid=customer_cid,
        doc_id=doc_id,
        id_photo_sha256=id_sha,
        live_photo_sha256=live_sha,
        distance=distance_val,
        confidence=confidence_val,
        match_result=match_result,
        face_geometry_ok=face_geometry_ok,
        threshold_used=threshold,
        decided_by=decided_by,
        decided_from="api",
        consent_token_id=consent_token_id,
    )
    db.add(row)
    db.flush()
    return row


# ---------------------------------------------------------------------------
# GET /api/v1/face-match/consent-template
# ---------------------------------------------------------------------------


@router.get("/consent-template", response_model=ConsentTemplateResponse)
def get_consent_template(
    p: Principal = Depends(current_principal),
) -> ConsentTemplateResponse:
    """Return biometric consent text for the tenant.

    This is a public informational endpoint — any authenticated caller may
    retrieve the consent text. It is not gated behind maker/checker because
    mobile clients need it before the user has authenticated with a full JWT.
    """
    _require_feature()
    return ConsentTemplateResponse(
        consent_text=(
            "By proceeding, you consent to the capture and processing of your "
            "facial biometric data for the purpose of identity verification. "
            "Your facial image will be processed locally and is not transmitted "
            "to any third party. The derived biometric template will be retained "
            "for a maximum of 90 days and then permanently deleted. "
            "You have the right to withdraw consent and request erasure at any time "
            "by contacting your branch officer."
        ),
        tenant_id=p.tenant,
        version="1.0",
        language="en",
    )


# ---------------------------------------------------------------------------
# POST /api/v1/face-match/consent-token
# ---------------------------------------------------------------------------


@router.post("/consent-token", response_model=ConsentTokenResponse, status_code=201)
def issue_consent_token(
    body: ConsentTokenRequest,
    db: Session = Depends(get_db),
    p: Principal = Depends(current_principal),
) -> ConsentTokenResponse:
    """Issue a short-lived (30 min) biometric consent JWT.

    The token encodes the customer_cid, tenant, and timestamp of consent.
    Requires X-API-Key at minimum (mobile app can call without a full JWT).
    """
    _require_feature()

    now = datetime.utcnow()
    expires_at = now + timedelta(minutes=CONSENT_TTL_MINUTES)

    # Record consent in biometric_consent table for GDPR audit trail
    consent_row = BiometricConsent(
        tenant_id=p.tenant,
        customer_cid=body.customer_cid,
        consent_version="1.0",
        language="en",
        given_at=now,
        signature_or_approval=body.signature,
        expires_at=expires_at,
    )
    db.add(consent_row)
    db.commit()
    db.refresh(consent_row)

    token = _issue_consent_jwt(p.tenant, body.customer_cid, body.signed_at)

    return ConsentTokenResponse(
        consent_token=token,
        expires_at=expires_at.isoformat() + "Z",
    )


# ---------------------------------------------------------------------------
# POST /api/v1/face-match
# ---------------------------------------------------------------------------


@router.post("", response_model=FaceMatchResponse)
async def match_faces(
    id_photo: UploadFile = File(..., description="ID document photo, JPEG or PNG, ≤ 5 MB"),
    live_photo: UploadFile = File(..., description="Live selfie photo, JPEG or PNG, ≤ 5 MB"),
    consent_token: str = Form(..., description="Consent JWT issued by /consent-token"),
    customer_cid: str = Form(..., description="Customer CIF for audit linkage"),
    doc_id: Optional[int] = Form(default=None, description="Optional DMS document ID"),
    db: Session = Depends(get_db),
    p: Principal = Depends(current_principal),
) -> FaceMatchResponse:
    """Match an ID photo against a live selfie.

    Auth: X-API-Key + optional JWT (role >= maker for web SPA; API key only for mobile).
    Returns match decision, distance, confidence, and geometry QA flags.

    DPIA compliance:
      - Raw images are discarded after encoding computation.
      - Live-photo encoding is NEVER persisted.
      - Audit log written with customer_cid, distance, match_result only.
    """
    _require_feature()
    t0 = time.monotonic()

    # --- Validate consent token ---
    _decode_consent_jwt(consent_token, p.tenant)

    # --- Read photos ---
    id_bytes = await id_photo.read()
    live_bytes = await live_photo.read()

    # Size check
    if len(id_bytes) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "error": "image_too_large",
                "message": "id_photo exceeds 5 MB limit.",
            },
        )
    if len(live_bytes) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "error": "image_too_large",
                "message": "live_photo exceeds 5 MB limit.",
            },
        )

    # MIME type check
    for photo_upload, fname in [(id_photo, "id_photo"), (live_photo, "live_photo")]:
        ct = (photo_upload.content_type or "").lower()
        if ct not in ALLOWED_MIME:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "invalid_image",
                    "message": f"{fname}: unsupported format '{ct}'. Use JPEG or PNG.",
                },
            )

    # --- Rate limit ---
    _check_rate_limit(db, p.tenant, customer_cid)

    # --- Tenant threshold ---
    threshold = _get_tenant_threshold(db, p.tenant)

    # --- Compute SHAs ---
    id_sha = _sha256(id_bytes)
    live_sha = _sha256(live_bytes)
    idem_key = _idempotency_key(p.tenant, customer_cid, id_sha, live_sha)

    # --- Check for cached ID encoding ---
    cached_id = _get_cached_encoding(db, p.tenant, id_sha)

    # --- Face match ---
    try:
        from ..services.face_match import (
            encoding_to_bytes,
            extract_face_encoding,
            perform_match,
        )
    except ImportError as exc:
        log.error("face_recognition import failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "biometric_service_unavailable",
                "message": "Biometric service unavailable. Please try again later.",
            },
        )

    try:
        result = perform_match(
            id_photo_bytes=id_bytes,
            live_photo_bytes=live_bytes,
            threshold=threshold,
            cached_id_encoding=cached_id,
        )
    except ImportError as exc:
        log.error("face_recognition import failed during match: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "biometric_service_unavailable",
                "message": "Biometric service unavailable. Please try again later.",
            },
        )

    # --- Store ID encoding (if geometry passed and we computed a fresh one) ---
    if result.face_geometry_ok and cached_id is None:
        try:
            id_enc = extract_face_encoding(id_bytes)
            enc_bytes = encoding_to_bytes(id_enc)
            geometry_json = {
                "eye_distance_px": result.id_photo_face_count,  # stored per geometry
                "face_count": result.id_photo_face_count,
            }
            _store_encoding(
                db,
                p.tenant,
                id_sha,
                "id_photo",
                enc_bytes,
                geometry_json,
                retention_days=90,
            )
        except Exception as enc_err:
            log.warning("Failed to cache ID encoding (non-fatal): %s", enc_err)

    # --- Write audit log and match record ---
    _write_audit_log(
        db,
        p.tenant,
        p.sub,
        customer_cid,
        result.distance,
        result.match,
        threshold,
        result.face_geometry_ok,
    )

    match_row = _write_match_record(
        db,
        p.tenant,
        customer_cid,
        id_sha,
        live_sha,
        result.distance,
        result.confidence,
        result.match,
        result.face_geometry_ok,
        threshold,
        p.sub,
        doc_id,
        None,
    )
    db.commit()

    # Live photo encoding is NEVER stored — privacy-first (contract AC-5).
    # Raw image bytes go out of scope here — GC handles memory.

    latency_ms = int((time.monotonic() - t0) * 1000)
    log.info(
        "{ts} tenant=%s customer_cid=%s distance=%s match_result=%s "
        "face_geometry_ok=%s latency_ms=%d status=ok",
        p.tenant,
        customer_cid,
        result.distance,
        result.match,
        result.face_geometry_ok,
        latency_ms,
    )

    return FaceMatchResponse(
        match=result.match,
        distance=result.distance,
        confidence=result.confidence,
        face_geometry_ok=result.face_geometry_ok,
        id_photo_face_count=result.id_photo_face_count,
        live_photo_face_count=result.live_photo_face_count,
        detail=result.detail,
        decision_at=result.decided_at.isoformat() + "Z",
        idempotency_key=idem_key,
    )


# ---------------------------------------------------------------------------
# GET /api/v1/face-match/{match_id}  — auditor only
# ---------------------------------------------------------------------------


@router.get("/{match_id}", response_model=MatchRecordResponse)
def get_match_record(
    match_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(require("audit_read")),
) -> MatchRecordResponse:
    """Retrieve a stored match decision. Auditor role required."""
    _require_feature()

    row = (
        db.query(BiometricMatch)
        .filter(
            BiometricMatch.id == match_id,
            BiometricMatch.tenant_id == p.tenant,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Match record {match_id} not found"},
        )

    return MatchRecordResponse(
        id=row.id,
        customer_cid=row.customer_cid,
        doc_id=row.doc_id,
        match=row.match_result,
        distance=row.distance,
        confidence=row.confidence,
        face_geometry_ok=row.face_geometry_ok,
        id_photo_sha256=row.id_photo_sha256,
        live_photo_sha256=row.live_photo_sha256,
        decided_at=row.decided_at.isoformat() + "Z",
        decided_by=row.decided_by,
    )


# ---------------------------------------------------------------------------
# Tenant threshold helper (reads from DB if TenantSettings exists)
# ---------------------------------------------------------------------------


def _get_tenant_threshold(db: Session, tenant_id: str) -> float:
    """Return the face_match_threshold for the given tenant (default 0.6)."""
    # Gracefully degrade: if tenant_settings table or column doesn't exist,
    # fall back to the default. This avoids hard failures during DB init.
    try:
        from sqlalchemy import text

        row = db.execute(
            text(
                "SELECT face_match_threshold FROM tenant_settings "
                "WHERE tenant_id = :tid LIMIT 1"
            ),
            {"tid": tenant_id},
        ).fetchone()
        if row and row[0] is not None:
            return float(row[0])
    except Exception:
        pass
    return 0.6

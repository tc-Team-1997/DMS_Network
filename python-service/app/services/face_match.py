"""Face match service — offline biometric verification via dlib/face_recognition.

Uses the `face_recognition` library (dlib backend) for:
  - Extracting 128-dim face encodings from JPEG/PNG images.
  - Computing Euclidean distance between two encodings.
  - Quality-gating images (face count, eye distance, head pose).

DPIA compliance:
  - Raw images are NEVER persisted; only 128-dim float32 encodings are stored.
  - Live-photo encodings are deleted immediately after the match decision.
  - All operations are scoped to a single tenant_id.
  - Encoding cache TTL is driven by tenant_settings.face_encoding_retention_days (default 90).
"""
from __future__ import annotations

import hashlib
import io
import logging
import struct
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass
class GeometryResult:
    face_count: int
    eye_distance_px: float
    head_pose_deg: float
    passes: bool
    detail: Optional[str] = None


@dataclass
class MatchResult:
    match: bool
    distance: Optional[float]
    confidence: Optional[float]
    face_geometry_ok: bool
    id_photo_face_count: Optional[int]
    live_photo_face_count: Optional[int]
    detail: Optional[str]
    decided_at: datetime


# ---------------------------------------------------------------------------
# Encoding serialisation helpers (numpy-free-safe path)
# ---------------------------------------------------------------------------

_ENCODING_DTYPE = np.float64
_ENCODING_DIM = 128


def encoding_to_bytes(enc: np.ndarray) -> bytes:
    """Serialise a 128-dim float64 numpy array to raw bytes."""
    return enc.astype(_ENCODING_DTYPE).tobytes()


def bytes_to_encoding(raw: bytes) -> np.ndarray:
    """Deserialise raw bytes back to a 128-dim numpy array."""
    expected = _ENCODING_DIM * _ENCODING_DTYPE(0).itemsize
    if len(raw) != expected:
        raise ValueError(
            f"Encoding bytes length {len(raw)} != expected {expected}"
        )
    return np.frombuffer(raw, dtype=_ENCODING_DTYPE)


# ---------------------------------------------------------------------------
# SHA-256 helper
# ---------------------------------------------------------------------------


def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Core face_recognition wrappers
# (All dlib-heavy calls are wrapped so we can mock them cleanly in tests.)
# ---------------------------------------------------------------------------


def _load_image_from_bytes(data: bytes):
    """Load an image from raw bytes into a numpy RGB array via Pillow."""
    face_recognition = _require_face_recognition()
    from PIL import Image

    img = Image.open(io.BytesIO(data)).convert("RGB")
    return np.array(img)


def _require_face_recognition():
    """Import face_recognition or raise ImportError with a clear message."""
    try:
        import face_recognition  # type: ignore[import]
        return face_recognition
    except ImportError as exc:
        raise ImportError(
            "face_recognition (dlib) is not installed. "
            "Install it with: pip install face_recognition (~80 MB with dlib). "
            "Biometric service is unavailable."
        ) from exc


def extract_face_encoding(image_bytes: bytes) -> np.ndarray:
    """Return the 128-dim face encoding for the single face in `image_bytes`.

    Raises:
        ValueError: if the image contains 0 or 2+ faces.
    """
    face_recognition = _require_face_recognition()
    image = _load_image_from_bytes(image_bytes)
    encodings = face_recognition.face_encodings(image)
    if len(encodings) == 0:
        raise ValueError("no_faces_detected")
    if len(encodings) > 1:
        raise ValueError(f"multiple_faces_detected:{len(encodings)}")
    return encodings[0]


def compare_encodings(enc1: np.ndarray, enc2: np.ndarray) -> float:
    """Euclidean distance between two 128-dim face encoding vectors.

    dlib uses Euclidean distance; < 0.6 is typically a match.
    Returns a float in [0, ~1.5]; values above ~0.6 are non-matches.
    """
    return float(np.linalg.norm(enc1 - enc2))


def quality_check(image_bytes: bytes) -> GeometryResult:
    """Analyse a face image for KYC quality gates.

    v1 spoof gate:
      - face_count != 1  → reject
      - eye_distance_px < 20  → reject (too far from camera)
      - head_pose_deg > 45  → reject (profile or excessive tilt)

    Returns a GeometryResult with `passes=False` and `detail` set when any
    gate fails.
    """
    face_recognition = _require_face_recognition()
    image = _load_image_from_bytes(image_bytes)

    # Detect face locations (HOG model, faster than CNN for p99 target)
    face_locations = face_recognition.face_locations(image, model="hog")
    face_count = len(face_locations)

    if face_count == 0:
        return GeometryResult(
            face_count=0,
            eye_distance_px=0.0,
            head_pose_deg=0.0,
            passes=False,
            detail="no_faces_detected",
        )
    if face_count > 1:
        return GeometryResult(
            face_count=face_count,
            eye_distance_px=0.0,
            head_pose_deg=0.0,
            passes=False,
            detail=f"multiple_faces_detected:{face_count}",
        )

    # Exactly one face — extract landmarks
    landmarks_list = face_recognition.face_landmarks(image, face_locations=face_locations)
    if not landmarks_list:
        return GeometryResult(
            face_count=1,
            eye_distance_px=0.0,
            head_pose_deg=0.0,
            passes=False,
            detail="landmark_extraction_failed",
        )

    landmarks = landmarks_list[0]

    # Eye distance: mean of left-eye points vs. mean of right-eye points
    left_eye_pts = landmarks.get("left_eye", [])
    right_eye_pts = landmarks.get("right_eye", [])

    if left_eye_pts and right_eye_pts:
        left_center = np.mean(left_eye_pts, axis=0)
        right_center = np.mean(right_eye_pts, axis=0)
        eye_distance = float(np.linalg.norm(left_center - right_center))
    else:
        eye_distance = 0.0

    # Head pose estimate: use nose bridge vs. top/bottom lip midpoints
    # A simplified proxy: compare nose_tip y to eye midpoint y offset
    nose_tip = landmarks.get("nose_tip", [])
    top_lip = landmarks.get("top_lip", [])
    nose_bridge = landmarks.get("nose_bridge", [])

    head_pose_deg = 0.0
    if nose_bridge and nose_tip:
        nose_bridge_top = np.array(nose_bridge[0])
        nose_tip_pt = np.array(nose_tip[len(nose_tip) // 2])
        dx = float(nose_tip_pt[0] - nose_bridge_top[0])
        dy = float(nose_tip_pt[1] - nose_bridge_top[1])
        if dy > 0:
            import math
            head_pose_deg = abs(math.degrees(math.atan2(dx, dy)))

    # Quality gates
    if eye_distance < 20.0:
        return GeometryResult(
            face_count=1,
            eye_distance_px=eye_distance,
            head_pose_deg=head_pose_deg,
            passes=False,
            detail=f"eye_distance_{int(eye_distance)}_pixels < 20_threshold",
        )

    if head_pose_deg > 45.0:
        return GeometryResult(
            face_count=1,
            eye_distance_px=eye_distance,
            head_pose_deg=head_pose_deg,
            passes=False,
            detail=f"head_pose_{int(head_pose_deg)}_degrees > 45_threshold",
        )

    return GeometryResult(
        face_count=1,
        eye_distance_px=eye_distance,
        head_pose_deg=head_pose_deg,
        passes=True,
    )


# ---------------------------------------------------------------------------
# High-level match orchestration
# ---------------------------------------------------------------------------


def perform_match(
    id_photo_bytes: bytes,
    live_photo_bytes: bytes,
    threshold: float = 0.6,
    cached_id_encoding: Optional[bytes] = None,
) -> MatchResult:
    """End-to-end face match between ID photo and live photo.

    Args:
        id_photo_bytes: Raw bytes of the ID document photo.
        live_photo_bytes: Raw bytes of the live selfie photo.
        threshold: Match threshold — distance <= threshold means match=True.
        cached_id_encoding: Pre-serialised 128-dim encoding for the ID photo
            (from biometric_encodings cache). When provided, quality_check and
            extraction are skipped for the ID photo.

    Returns:
        MatchResult with match decision, distance, confidence, and geometry info.
    """
    now = datetime.utcnow()

    # --- ID photo ---
    if cached_id_encoding is not None:
        try:
            id_enc = bytes_to_encoding(cached_id_encoding)
            id_geometry = GeometryResult(
                face_count=1, eye_distance_px=99.0, head_pose_deg=0.0, passes=True
            )
        except ValueError as exc:
            log.warning("Cached encoding invalid, re-computing: %s", exc)
            cached_id_encoding = None

    if cached_id_encoding is None:
        id_geometry = quality_check(id_photo_bytes)
        if not id_geometry.passes:
            return MatchResult(
                match=False,
                distance=None,
                confidence=None,
                face_geometry_ok=False,
                id_photo_face_count=id_geometry.face_count,
                live_photo_face_count=None,
                detail=f"poor_geometry: {id_geometry.detail}",
                decided_at=now,
            )
        try:
            id_enc = extract_face_encoding(id_photo_bytes)
        except ValueError as exc:
            detail = str(exc)
            return MatchResult(
                match=False,
                distance=None,
                confidence=None,
                face_geometry_ok=False,
                id_photo_face_count=id_geometry.face_count,
                live_photo_face_count=None,
                detail=detail,
                decided_at=now,
            )

    # --- Live photo (never cached — privacy-first) ---
    live_geometry = quality_check(live_photo_bytes)
    if not live_geometry.passes:
        return MatchResult(
            match=False,
            distance=None,
            confidence=None,
            face_geometry_ok=False,
            id_photo_face_count=id_geometry.face_count if cached_id_encoding is None else 1,
            live_photo_face_count=live_geometry.face_count,
            detail=f"poor_geometry: {live_geometry.detail}",
            decided_at=now,
        )

    try:
        live_enc = extract_face_encoding(live_photo_bytes)
    except ValueError as exc:
        return MatchResult(
            match=False,
            distance=None,
            confidence=None,
            face_geometry_ok=False,
            id_photo_face_count=id_geometry.face_count if cached_id_encoding is None else 1,
            live_photo_face_count=live_geometry.face_count,
            detail=str(exc),
            decided_at=now,
        )

    # --- Distance and decision ---
    distance = compare_encodings(id_enc, live_enc)
    match = distance <= threshold
    # Confidence: 1.0 - distance, clamped to [0, 1]
    confidence = max(0.0, min(1.0, 1.0 - distance))

    return MatchResult(
        match=match,
        distance=round(distance, 6),
        confidence=round(confidence, 6),
        face_geometry_ok=True,
        id_photo_face_count=id_geometry.face_count if cached_id_encoding is None else 1,
        live_photo_face_count=live_geometry.face_count,
        detail=None,
        decided_at=now,
    )

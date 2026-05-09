"""LocalFaceMatch — delegates to services/face_match.py (dlib backend).

If face_recognition (dlib) is not installed, returns a stub no-match result
and logs a warning. Do not raise — callers must handle degraded biometrics
gracefully in the KYC flow.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging

from ...providers_base import FaceMatchProvider, FaceMatchResult

log = logging.getLogger(__name__)


class LocalFaceMatch(FaceMatchProvider):
    """Biometric face comparison using the dlib/face_recognition backend.

    Delegates to app.services.face_match.perform_match() which implements
    geometry quality gates (eye distance, head pose) and 128-dim Euclidean
    distance comparison.

    When face_recognition (dlib) is not installed, a stub result is returned
    (match=False, similarity=0.0) with a warning log. DPIA compliance note:
    the underlying service never persists raw images — only 128-dim float32
    encodings, which are deleted after the match decision.
    """

    def compare(self, face_a: bytes, face_b: bytes) -> FaceMatchResult:
        """Compare two face images and return a match decision.

        Args:
            face_a: Raw image bytes of the reference face (e.g. ID document photo).
            face_b: Raw image bytes of the probe face (e.g. live selfie).

        Returns:
            FaceMatchResult with .match and .similarity populated.
            similarity is derived as max(0, 1 - euclidean_distance).
        """
        try:
            from app.services.face_match import perform_match
        except ImportError as exc:
            log.warning(
                "LocalFaceMatch: face_match service unavailable (%s). "
                "Install face_recognition (dlib) to enable biometric matching. "
                "Returning stub no-match result.",
                exc,
            )
            return FaceMatchResult(
                match=False,
                similarity=0.0,
                detail="face_recognition_not_installed",
            )

        try:
            result = perform_match(face_a, face_b)
        except Exception as exc:
            log.error("LocalFaceMatch: perform_match raised: %s", exc)
            return FaceMatchResult(
                match=False,
                similarity=0.0,
                detail=f"error: {exc}",
            )

        # perform_match returns MatchResult dataclass with .match, .confidence, .detail
        similarity = float(result.confidence) if result.confidence is not None else 0.0
        return FaceMatchResult(
            match=result.match,
            similarity=similarity,
            detail=result.detail,
        )

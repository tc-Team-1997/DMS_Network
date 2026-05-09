"""AWS Rekognition face-match stub — registered but NOT enabled by default."""
from __future__ import annotations

from ...providers_base import FaceMatchProvider, FaceMatchResult

_MSG = (
    "AWS Rekognition adapter is registered but not enabled. "
    "Set integrations.face_match.provider='aws' in tenant_config and provide "
    "AWS credentials. boto3 must be installed separately: pip install boto3"
)


class RekognitionFaceMatch(FaceMatchProvider):
    """AWS Rekognition face comparison stub."""

    def compare(self, face_a: bytes, face_b: bytes) -> FaceMatchResult:
        raise NotImplementedError(_MSG)

"""AWS Macie PII detection stub — registered but NOT enabled by default.

AWS Macie is an S3-native data security service; PII detection is its core
capability. Mapped to PiiDetectorProvider. No local equivalent is seeded;
the 'pii' capability kind is an extension point for future local PII scanning
(e.g. spaCy-based NER or Presidio).
"""
from __future__ import annotations

from ...providers_base import PiiDetectorProvider

_MSG = (
    "AWS Macie adapter is registered but not enabled. "
    "Set integrations.pii.provider='aws' in tenant_config and provide "
    "AWS credentials. boto3 must be installed separately: pip install boto3. "
    "Note: Macie is S3-native; direct document-level PII scanning may require "
    "Comprehend or a custom Presidio implementation instead."
)


class MaciePiiDetector(PiiDetectorProvider):
    """AWS Macie PII detection stub."""

    def detect_pii(self, text: str) -> list[dict]:
        raise NotImplementedError(_MSG)

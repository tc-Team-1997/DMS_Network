"""AWS Comprehend NLP stub — registered but NOT enabled by default.

AWS Comprehend provides entity detection, sentiment analysis, and key-phrase
extraction. It is mapped to the NlpProvider base class. No local equivalent
is seeded; the 'nlp' capability kind is an extension point for future use.
"""
from __future__ import annotations

from ...providers_base import NlpProvider

_MSG = (
    "AWS Comprehend adapter is registered but not enabled. "
    "Set integrations.nlp.provider='aws' in tenant_config and provide "
    "AWS credentials. boto3 must be installed separately: pip install boto3"
)


class ComprehendNlp(NlpProvider):
    """AWS Comprehend NLP stub."""

    def detect_entities(self, text: str, *, lang: str = "en") -> list[dict]:
        raise NotImplementedError(_MSG)

    def detect_sentiment(self, text: str, *, lang: str = "en") -> dict:
        raise NotImplementedError(_MSG)

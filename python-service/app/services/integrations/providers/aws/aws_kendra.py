"""AWS Kendra embedding stub — registered but NOT enabled by default.

Note: Kendra is a document-search service, not a dense-embedding API.
It is mapped to the EmbeddingProvider slot as a placeholder for the Kendra
Retrieve API which returns semantic passages. A true Bedrock Embeddings or
SageMaker embedding endpoint would be the better fit — this stub preserves
the registry slot for future wiring.
"""
from __future__ import annotations

from ...providers_base import EmbeddingProvider

_MSG = (
    "AWS Kendra adapter is registered but not enabled. "
    "Set integrations.embedding.provider='aws' in tenant_config and provide "
    "AWS credentials. boto3 must be installed separately: pip install boto3. "
    "Note: consider AWS Bedrock Embeddings as an alternative to Kendra for "
    "dense vector embeddings."
)


class KendraEmbedding(EmbeddingProvider):
    """AWS Kendra semantic embedding stub."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError(_MSG)

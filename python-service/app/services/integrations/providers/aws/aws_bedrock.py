"""AWS Bedrock LLM stub — registered but NOT enabled by default."""
from __future__ import annotations

from typing import Optional

from ...providers_base import ChatMessage, LlmProvider, LlmResponse

_MSG = (
    "AWS Bedrock adapter is registered but not enabled. "
    "Set integrations.llm.provider='aws' in tenant_config and provide "
    "AWS credentials. boto3 must be installed separately: pip install boto3"
)


class BedrockLlm(LlmProvider):
    """AWS Bedrock LLM stub."""

    def generate(self, prompt: str, *, model: Optional[str] = None, max_tokens: int = 1024) -> LlmResponse:
        raise NotImplementedError(_MSG)

    def chat(self, messages: list[ChatMessage], *, model: Optional[str] = None) -> LlmResponse:
        raise NotImplementedError(_MSG)

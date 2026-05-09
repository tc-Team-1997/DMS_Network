"""AWS Translate stub — registered but NOT enabled by default."""
from __future__ import annotations

from ...providers_base import TranslateProvider

_MSG = (
    "AWS Translate adapter is registered but not enabled. "
    "Set integrations.translate.provider='aws' in tenant_config and provide "
    "AWS credentials. boto3 must be installed separately: pip install boto3"
)


class AwsTranslate(TranslateProvider):
    """AWS Translate stub."""

    def translate(self, text: str, *, source_lang: str, target_lang: str) -> str:
        raise NotImplementedError(_MSG)

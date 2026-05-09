"""AWS Textract OCR stub — registered but NOT enabled by default.

Set integrations.ocr.provider='aws' in tenant_config and provide
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION credentials
to activate. boto3 is NOT listed in requirements.txt; install it separately.
"""
from __future__ import annotations

from ...providers_base import OcrProvider, OcrResult

_MSG = (
    "AWS Textract adapter is registered but not enabled. "
    "Set integrations.ocr.provider='aws' in tenant_config and provide "
    "AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION). "
    "boto3 must be installed separately: pip install boto3"
)


class TextractOcr(OcrProvider):
    """AWS Textract OCR provider stub."""

    def extract_text(self, file_bytes: bytes, *, mime_type: str, lang: str = "en") -> OcrResult:
        raise NotImplementedError(_MSG)

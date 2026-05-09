"""AWS CloudFront CDN stub — registered but NOT enabled by default."""
from __future__ import annotations

from ...providers_base import CdnProvider

_MSG = (
    "AWS CloudFront adapter is registered but not enabled. "
    "Set integrations.cdn.provider='aws' in tenant_config and provide "
    "AWS credentials (CLOUDFRONT_DISTRIBUTION_ID, CLOUDFRONT_DOMAIN). "
    "boto3 must be installed separately: pip install boto3"
)


class CloudFrontCdn(CdnProvider):
    """AWS CloudFront CDN stub."""

    def public_url(self, key: str) -> str:
        raise NotImplementedError(_MSG)

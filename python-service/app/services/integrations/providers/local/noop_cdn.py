"""NoopCdn — returns root-relative URLs served by the Node proxy.

Appropriate for local development where files are served from the Node app's
/uploads path or from the Python service's static mount. No CDN signature,
no expiry, no geographic distribution. Switch to CloudFrontCdn or a MinIO
presigned-URL provider for production.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

from ...providers_base import CdnProvider


class NoopCdn(CdnProvider):
    """CDN stub that returns a root-relative /uploads/<key> URL.

    The Node app serves this path via its existing static/uploads mount.
    Suitable for demos and local deployments where no CDN is available.
    """

    def public_url(self, key: str) -> str:
        """Return a root-relative URL for the object at *key*.

        Args:
            key: Storage key as returned by StorageProvider.put().

        Returns:
            String of the form '/uploads/<key>' — served by the Node proxy.
        """
        # Strip any leading slash to avoid double-slash in the URL.
        clean_key = key.lstrip("/")
        return f"/uploads/{clean_key}"

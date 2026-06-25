/**
 * ssoHandoff.ts — read the one-time SSO token handed back from a redirect flow.
 *
 * OIDC/SAML are browser-redirect flows: the gateway validates the IdP
 * assertion/code and then redirects the browser to
 *   <WEB_APP_URL>/login#token=<urlencoded JWT>
 * The token rides in the URL *fragment* so it is never sent to a server and
 * never appears in access logs (see .superpowers/sdd/sso-gateway-report.md).
 *
 * This helper extracts that token from `location.hash`, then the caller stores
 * it via the existing AuthContext (identical to a local login) and clears the
 * hash so a refresh / shared link can't replay it.
 */

/** Pull the `#token=…` JWT out of a location hash, or null if absent. */
export function readHandoffToken(hash: string): string | null {
  if (!hash) return null;
  // Strip a single leading '#'. The fragment may be `#token=…` or
  // `#error=…&…` — parse it as URL-search params for robustness.
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token");
  return token && token.length > 0 ? token : null;
}

/** Remove the handoff fragment from the address bar without a navigation. */
export function clearHandoffHash(): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", pathname + search);
}

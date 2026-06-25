/**
 * authConfig.ts — public SSO discovery for the login screen.
 *
 * The gateway exposes a PUBLIC (no-auth) `GET /auth/config` that reports
 * whether local username/password login is enabled (always `true`) and which
 * enterprise SSO providers are turned on. The login page calls this to decide
 * which "Sign in with …" buttons to render.
 *
 * Shape (see .superpowers/sdd/sso-gateway-report.md):
 *   { "local": true,
 *     "providers": [
 *       { "id": "ldap", "enabled": true, "displayName": "Active Directory", "loginUrl": "/auth/ldap/login" },
 *       { "id": "oidc", "enabled": true, "displayName": "Single Sign-On",    "loginUrl": "/auth/oidc/login" }
 *     ] }
 *
 * Only ENABLED providers are returned by the gateway.
 */
import { SVC } from "../config.js";

export type SsoProviderId = "ldap" | "oidc" | "saml";

export interface SsoProvider {
  id: SsoProviderId;
  enabled: boolean;
  displayName: string;
  /** Browser navigation target (OIDC/SAML) or LDAP login POST endpoint. */
  loginUrl: string;
}

export interface AuthConfig {
  local: boolean;
  providers: SsoProvider[];
}

/** Fetch the public auth config. Resolves to a local-only config on failure
 *  so the login screen always renders (graceful degradation). */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(`${SVC.auth}/auth/config`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { local: true, providers: [] };
    const data = (await res.json()) as Partial<AuthConfig>;
    return {
      local: data.local !== false,
      providers: Array.isArray(data.providers)
        ? data.providers.filter((p): p is SsoProvider => !!p && p.enabled === true)
        : [],
    };
  } catch {
    return { local: true, providers: [] };
  }
}

/** POST credentials to a provider's LDAP login endpoint. Returns the gateway's
 *  `{ token, user }` body exactly like a local login. */
export async function ldapLogin(
  loginUrl: string,
  username: string,
  password: string,
): Promise<{ token: string; user: import("@zordms/types").AuthUser }> {
  const res = await fetch(`${SVC.auth}${loginUrl}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error("ldap_login_failed"), { status: res.status, body });
  }
  return res.json();
}

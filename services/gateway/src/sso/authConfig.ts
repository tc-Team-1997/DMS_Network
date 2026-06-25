// Typed auth-config loader for enterprise SSO providers.
//
// All three providers (LDAP/AD, OIDC, SAML) are *independently* feature-flagged
// purely via environment variables. When a provider's AUTH_*_ENABLED flag is not
// exactly "true", that provider is considered disabled: its routes are never
// mounted and it never appears in GET /auth/config. Local username/password
// login is always available and is the default — SSO is strictly additive.

export type ProviderId = "ldap" | "oidc" | "saml";

export interface LdapConfig {
  enabled: boolean;
  displayName: string;
  url: string;
  bindDN: string;
  bindCredentials: string;
  searchBase: string;
  searchFilter: string; // contains {{username}} placeholder
  groupAttr: string;
  /** Optional IdP-group -> local-role map (parsed from LDAP_GROUP_ROLE_MAP json). */
  groupRoleMap: Record<string, string>;
}

export interface OidcConfig {
  enabled: boolean;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string; // space-delimited
  groupRoleMap: Record<string, string>;
}

export interface SamlConfig {
  enabled: boolean;
  displayName: string;
  entryPoint: string;
  issuer: string;
  idpCert: string;
  callbackUrl: string;
  groupRoleMap: Record<string, string>;
}

export interface AuthConfig {
  /** Default role granted to JIT-provisioned external users. */
  ssoDefaultRole: string;
  /**
   * Base URL of the web app the OIDC/SAML callbacks redirect back to with the
   * minted internal JWT (token handoff). Defaults to the CORS origin.
   */
  webAppUrl: string;
  ldap: LdapConfig;
  oidc: OidcConfig;
  saml: SamlConfig;
}

function flag(v: string | undefined): boolean {
  return v === "true";
}

function parseRoleMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(parsed)) {
        if (typeof val === "string") out[k] = val;
      }
      return out;
    }
  } catch {
    // Malformed JSON -> treat as no mapping rather than crashing the gateway.
  }
  return {};
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  return {
    ssoDefaultRole: env.SSO_DEFAULT_ROLE ?? "Viewer",
    webAppUrl: env.WEB_APP_URL ?? env.CORS_ORIGIN ?? "http://localhost:5174",
    ldap: {
      enabled: flag(env.AUTH_LDAP_ENABLED),
      displayName: env.LDAP_DISPLAY_NAME ?? "Active Directory",
      url: env.LDAP_URL ?? "",
      bindDN: env.LDAP_BIND_DN ?? "",
      bindCredentials: env.LDAP_BIND_CREDENTIALS ?? "",
      searchBase: env.LDAP_SEARCH_BASE ?? "",
      searchFilter: env.LDAP_SEARCH_FILTER ?? "(sAMAccountName={{username}})",
      groupAttr: env.LDAP_GROUP_ATTR ?? "memberOf",
      groupRoleMap: parseRoleMap(env.LDAP_GROUP_ROLE_MAP),
    },
    oidc: {
      enabled: flag(env.AUTH_OIDC_ENABLED),
      displayName: env.OIDC_DISPLAY_NAME ?? "Single Sign-On",
      issuer: env.OIDC_ISSUER ?? "",
      clientId: env.OIDC_CLIENT_ID ?? "",
      clientSecret: env.OIDC_CLIENT_SECRET ?? "",
      redirectUri: env.OIDC_REDIRECT_URI ?? "",
      scopes: env.OIDC_SCOPES ?? "openid email profile",
      groupRoleMap: parseRoleMap(env.OIDC_GROUP_ROLE_MAP),
    },
    saml: {
      enabled: flag(env.AUTH_SAML_ENABLED),
      displayName: env.SAML_DISPLAY_NAME ?? "Single Sign-On",
      entryPoint: env.SAML_ENTRY_POINT ?? "",
      issuer: env.SAML_ISSUER ?? "zordms",
      idpCert: env.SAML_IDP_CERT ?? "",
      callbackUrl: env.SAML_CALLBACK_URL ?? "",
      groupRoleMap: parseRoleMap(env.SAML_GROUP_ROLE_MAP),
    },
  };
}

export interface ProviderDescriptor {
  id: ProviderId;
  enabled: boolean;
  displayName: string;
  loginUrl: string;
}

/** Public descriptor list for GET /auth/config — only enabled providers. */
export function enabledProviders(auth: AuthConfig): ProviderDescriptor[] {
  const all: ProviderDescriptor[] = [
    { id: "ldap", enabled: auth.ldap.enabled, displayName: auth.ldap.displayName, loginUrl: "/auth/ldap/login" },
    { id: "oidc", enabled: auth.oidc.enabled, displayName: auth.oidc.displayName, loginUrl: "/auth/oidc/login" },
    { id: "saml", enabled: auth.saml.enabled, displayName: auth.saml.displayName, loginUrl: "/auth/saml/login" },
  ];
  return all.filter((p) => p.enabled);
}

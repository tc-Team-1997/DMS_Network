// Thin, mockable client wrappers for the three SSO providers.
//
// Each wrapper exposes a tiny verb-shaped interface that returns a *verified
// external identity*. Tests inject fakes (no network); production code lazily
// imports the heavy libs (ldap-authentication, openid-client, @node-saml/node-saml)
// only when a real bind/exchange/validation is performed.

import type { ExternalIdentity } from "./jit.js";
import type { LdapConfig, OidcConfig, SamlConfig } from "./authConfig.js";

// ---------------------------------------------------------------------------
// LDAP / Active Directory
// ---------------------------------------------------------------------------

export interface LdapClient {
  /** Bind to AD/LDAP with the user's credentials. Returns null on bad creds. */
  authenticate(cfg: LdapConfig, username: string, password: string): Promise<ExternalIdentity | null>;
}

export function createLdapClient(): LdapClient {
  return {
    async authenticate(cfg, username, password) {
      // ldap-authentication is CommonJS; import lazily so tests never load it.
      const mod = await import("ldap-authentication");
      const authenticate = (mod as any).authenticate ?? (mod as any).default?.authenticate;
      try {
        const user = await authenticate({
          ldapOpts: { url: cfg.url },
          adminDn: cfg.bindDN,
          adminPassword: cfg.bindCredentials,
          userPassword: password,
          userSearchBase: cfg.searchBase,
          usernameAttribute: undefined,
          searchUserFilter: cfg.searchFilter.replace(/\{\{username\}\}/g, username),
          // Pull the group attribute so we can map groups->roles.
          attributes: ["sAMAccountName", "mail", "displayName", "cn", cfg.groupAttr],
        });
        if (!user) return null;
        const groupsRaw = (user as any)[cfg.groupAttr];
        const groups = Array.isArray(groupsRaw) ? groupsRaw : groupsRaw ? [groupsRaw] : [];
        return {
          username: (user as any).sAMAccountName ?? username,
          email: (user as any).mail,
          displayName: (user as any).displayName ?? (user as any).cn,
          groups,
        };
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// OIDC / OAuth2
// ---------------------------------------------------------------------------

export interface OidcAuthRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcClient {
  /** Build the IdP authorization redirect (state + nonce + PKCE). */
  buildAuthRequest(cfg: OidcConfig): Promise<OidcAuthRequest>;
  /** Exchange the callback code and validate the id_token -> verified identity. */
  exchange(
    cfg: OidcConfig,
    params: { code: string; state: string },
    expected: { state: string; nonce: string; codeVerifier: string },
  ): Promise<ExternalIdentity>;
}

export function createOidcClient(): OidcClient {
  // openid-client v6 functional API, lazily loaded.
  async function discover(cfg: OidcConfig): Promise<any> {
    const oidc = await import("openid-client");
    return oidc.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret);
  }
  return {
    async buildAuthRequest(cfg) {
      const oidc = await import("openid-client");
      const config = await discover(cfg);
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: cfg.redirectUri,
        scope: cfg.scopes,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return { authorizationUrl: url.href, state, nonce, codeVerifier };
    },
    async exchange(cfg, params, expected) {
      const oidc = await import("openid-client");
      const config = await discover(cfg);
      const currentUrl = new URL(cfg.redirectUri);
      currentUrl.searchParams.set("code", params.code);
      currentUrl.searchParams.set("state", params.state);
      const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
        expectedState: expected.state,
        expectedNonce: expected.nonce,
        pkceCodeVerifier: expected.codeVerifier,
      });
      const claims = tokens.claims() ?? {};
      const groups = Array.isArray((claims as any).groups) ? (claims as any).groups : [];
      return {
        email: (claims as any).email,
        username: (claims as any).preferred_username ?? (claims as any).email,
        displayName: (claims as any).name,
        groups,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// SAML 2.0
// ---------------------------------------------------------------------------

export interface SamlClient {
  /** Build the IdP SSO redirect URL (AuthnRequest). */
  buildLoginUrl(cfg: SamlConfig, relayState?: string): Promise<string>;
  /** Validate the POSTed SAML assertion (ACS) -> verified identity. */
  validatePostResponse(cfg: SamlConfig, body: Record<string, any>): Promise<ExternalIdentity>;
}

export function createSamlClient(): SamlClient {
  async function build(cfg: SamlConfig): Promise<any> {
    const { SAML } = await import("@node-saml/node-saml");
    return new SAML({
      entryPoint: cfg.entryPoint,
      issuer: cfg.issuer,
      idpCert: cfg.idpCert,
      callbackUrl: cfg.callbackUrl,
      // We mint our own JWT and never accept unsigned assertions in prod.
      wantAssertionsSigned: true,
      audience: false,
    } as any);
  }
  return {
    async buildLoginUrl(cfg, relayState) {
      const saml = await build(cfg);
      return saml.getAuthorizeUrlAsync(relayState ?? "", undefined, {});
    },
    async validatePostResponse(cfg, body) {
      const saml = await build(cfg);
      const { profile } = await saml.validatePostResponseAsync(body);
      const p: any = profile ?? {};
      const groupsRaw = p.groups ?? p["http://schemas.xmlsoap.org/claims/Group"];
      const groups = Array.isArray(groupsRaw) ? groupsRaw : groupsRaw ? [groupsRaw] : [];
      return {
        email: p.email ?? p.nameID,
        username: p.username ?? p.email ?? p.nameID,
        displayName: p.displayName ?? p.cn,
        groups,
      };
    },
  };
}

export interface SsoClients {
  ldap: LdapClient;
  oidc: OidcClient;
  saml: SamlClient;
}

export function createSsoClients(): SsoClients {
  return { ldap: createLdapClient(), oidc: createOidcClient(), saml: createSamlClient() };
}

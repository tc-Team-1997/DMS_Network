// DEPRECATED — replaced by the enterprise SSO implementation in the gateway.
//
// Enterprise SSO (LDAP/AD, OIDC, SAML 2.0) now lives in the TypeScript gateway
// at services/gateway/src/sso/*. It is purely env-gated (AUTH_LDAP_ENABLED /
// AUTH_OIDC_ENABLED / AUTH_SAML_ENABLED), mints the SAME internal JWT as local
// login (claims from resolveUserAuthz), and JIT-provisions local users. See
// services/gateway/src/sso/index.ts and GET /auth/config.
//
// This passport-based stub remained only so the legacy monolith (server.js)
// could boot; it no longer wires any SSO. configure(app) is now an inert no-op.

function configure() {
  console.log("[saml] legacy SAML stub disabled — use the gateway SSO (services/gateway/src/sso, AUTH_SAML_ENABLED)");
  return false;
}

module.exports = { configure };

// SSO router: mounts ONLY the enabled providers and always exposes the public
// GET /auth/config so the login UI can render the right buttons. Disabled
// providers are never mounted; their would-be routes return
// 404 { error: "provider_disabled" } via a catch-all guard.

import { Router } from "express";
import jwt from "jsonwebtoken";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { loadAuthConfig, enabledProviders, type AuthConfig } from "./authConfig.js";
import { createSsoClients, type SsoClients } from "./clients.js";
import { mapAndIssue, type ExternalIdentity } from "./jit.js";
import { LdapLoginBodySchema } from "../schemas.js";

export interface SsoDeps {
  knex: Knex;
  config: AppConfig;
  authConfig?: AuthConfig;
  ssoClients?: SsoClients;
}

interface OidcTransient { state: string; nonce: string; codeVerifier: string }

// -----------------------------------------------------------------------------
// OIDC transient state — STATELESS so any replica can complete the callback.
//
// Previously the {state,nonce,codeVerifier} lived in an in-process Map, which
// breaks behind a load balancer with >1 gateway replica: /auth/oidc/callback
// may land on a different replica than /auth/oidc/login and fail "invalid_state".
//
// Instead we serialize the transient into a short-lived (10m) HS256 JWT signed
// with the gateway secret and hand it to the browser as an HttpOnly cookie
// ("oidc_tx"). The IdP redirects the *same* browser back to the callback, which
// carries the cookie, so any replica can verify it locally with the shared
// secret — no shared server-side store (Redis/sticky sessions) required.
//
// Only OIDC needs this: LDAP is stateless already (single POST bind, no redirect
// round-trip), and SAML uses the IdP-driven POST binding where the IdP returns a
// self-contained signed assertion to the ACS — no server-side transient state.
// -----------------------------------------------------------------------------
const OIDC_TX_COOKIE = "oidc_tx";
const OIDC_STATE_TTL_SEC = 10 * 60; // 10 minutes

/** True when the gateway is serving over HTTPS (prod / behind a TLS proxy), in
 *  which case the transient cookie must be flagged Secure. */
function secureCookies(): boolean {
  return process.env.NODE_ENV === "production"
    || process.env.TRUST_PROXY === "true"
    || process.env.HTTPS === "true";
}

/** Common flags for the OIDC transient cookie. SameSite=Lax is REQUIRED so the
 *  top-level GET redirect back from the IdP still sends the cookie. */
function oidcCookieOpts() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: secureCookies(),
    path: "/auth/oidc",
  };
}

/** Build the SSO router. Reads deps from app.locals at request time so tests can
 *  inject fake clients/authConfig without re-wiring. */
export function ssoRouter(): Router {
  const r = Router();

  function deps(req: import("express").Request): Required<Pick<SsoDeps, "knex" | "config">> & {
    authConfig: AuthConfig;
    ssoClients: SsoClients;
  } {
    const d = req.app.locals.deps as SsoDeps;
    return {
      knex: d.knex,
      config: d.config,
      authConfig: d.authConfig ?? loadAuthConfig(),
      ssoClients: d.ssoClients ?? createSsoClients(),
    };
  }

  // -------------------------------------------------------------------------
  // PUBLIC config endpoint — no auth. Only enabled providers are listed.
  // -------------------------------------------------------------------------
  r.get("/config", (req, res) => {
    const { authConfig } = deps(req);
    res.json({ local: true, providers: enabledProviders(authConfig) });
  });

  // -------------------------------------------------------------------------
  // LDAP / AD — POST /auth/ldap/login { username, password }
  // -------------------------------------------------------------------------
  r.post("/ldap/login", async (req, res) => {
    const { knex, config, authConfig, ssoClients } = deps(req);
    if (!authConfig.ldap.enabled) { res.status(404).json({ error: "provider_disabled" }); return; }
    const parsed = LdapLoginBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "validation_error",
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
      });
      return;
    }
    const { username, password } = parsed.data;
    try {
      const identity = await ssoClients.ldap.authenticate(authConfig.ldap, username, password);
      if (!identity) { res.status(401).json({ error: "invalid_credentials" }); return; }
      const result = await mapAndIssue(knex, config, identity, {
        provider: "ldap",
        defaultRole: authConfig.ssoDefaultRole,
        groupRoleMap: authConfig.ldap.groupRoleMap,
      });
      res.json({ token: result.token, user: result.user });
    } catch {
      res.status(500).json({ error: "ldap_login_failed" });
    }
  });

  // -------------------------------------------------------------------------
  // OIDC — GET /auth/oidc/login -> redirect; GET /auth/oidc/callback -> handoff
  // -------------------------------------------------------------------------
  r.get("/oidc/login", async (req, res) => {
    const { config, authConfig, ssoClients } = deps(req);
    if (!authConfig.oidc.enabled) { res.status(404).json({ error: "provider_disabled" }); return; }
    try {
      const ar = await ssoClients.oidc.buildAuthRequest(authConfig.oidc);
      // Serialize the transient into a short-lived signed cookie instead of a
      // server-side store. exp is enforced by jwt.verify; iat lets us audit age.
      const tx = jwt.sign(
        { state: ar.state, nonce: ar.nonce, codeVerifier: ar.codeVerifier } as OidcTransient,
        config.jwtSecret,
        { algorithm: "HS256", expiresIn: OIDC_STATE_TTL_SEC },
      );
      res.cookie(OIDC_TX_COOKIE, tx, { ...oidcCookieOpts(), maxAge: OIDC_STATE_TTL_SEC * 1000 });
      res.redirect(ar.authorizationUrl);
    } catch {
      res.status(500).json({ error: "oidc_login_failed" });
    }
  });

  r.get("/oidc/callback", async (req, res) => {
    const { knex, config, authConfig, ssoClients } = deps(req);
    if (!authConfig.oidc.enabled) { res.status(404).json({ error: "provider_disabled" }); return; }
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    // Always clear the transient cookie — on success and on every failure path.
    const clear = () => res.clearCookie(OIDC_TX_COOKIE, oidcCookieOpts());

    // Read + verify the signed transient cookie. A missing cookie (e.g. a
    // different replica with no shared memory) or any mismatch/expiry is a hard
    // 400 invalid_state — exactly as before, but now correct across replicas.
    const raw = (req.cookies?.[OIDC_TX_COOKIE] ?? "") as string;
    let transient: OidcTransient | null = null;
    if (raw) {
      try {
        transient = jwt.verify(raw, config.jwtSecret, { algorithms: ["HS256"] }) as OidcTransient;
      } catch {
        transient = null; // expired/forged/tampered -> treated as invalid_state below
      }
    }
    if (!code || !state || !transient || transient.state !== state) {
      clear();
      res.status(400).json({ error: "invalid_state" }); return;
    }
    clear();
    try {
      const identity = await ssoClients.oidc.exchange(authConfig.oidc, { code, state }, transient);
      const result = await mapAndIssue(knex, config, identity, {
        provider: "oidc",
        defaultRole: authConfig.ssoDefaultRole,
        groupRoleMap: authConfig.oidc.groupRoleMap,
      });
      res.redirect(handoffUrl(authConfig, result.token));
    } catch {
      res.status(401).json({ error: "oidc_callback_failed" });
    }
  });

  // -------------------------------------------------------------------------
  // SAML — GET /auth/saml/login -> redirect; POST /auth/saml/callback (ACS)
  // -------------------------------------------------------------------------
  r.get("/saml/login", async (req, res) => {
    const { authConfig, ssoClients } = deps(req);
    if (!authConfig.saml.enabled) { res.status(404).json({ error: "provider_disabled" }); return; }
    try {
      const url = await ssoClients.saml.buildLoginUrl(authConfig.saml);
      res.redirect(url);
    } catch {
      res.status(500).json({ error: "saml_login_failed" });
    }
  });

  r.post("/saml/callback", async (req, res) => {
    const { knex, config, authConfig, ssoClients } = deps(req);
    if (!authConfig.saml.enabled) { res.status(404).json({ error: "provider_disabled" }); return; }
    try {
      const identity: ExternalIdentity = await ssoClients.saml.validatePostResponse(authConfig.saml, req.body ?? {});
      const result = await mapAndIssue(knex, config, identity, {
        provider: "saml",
        defaultRole: authConfig.ssoDefaultRole,
        groupRoleMap: authConfig.saml.groupRoleMap,
      });
      res.redirect(handoffUrl(authConfig, result.token));
    } catch {
      res.status(401).json({ error: "saml_callback_failed" });
    }
  });

  return r;
}

/**
 * Token handoff: redirect the browser back to the web app with the minted
 * internal JWT in the URL fragment (#token=...), which never hits servers/logs.
 * The SPA reads location.hash on /login, stores the token, and clears the hash.
 */
function handoffUrl(authConfig: AuthConfig, token: string): string {
  const base = authConfig.webAppUrl.replace(/\/$/, "");
  return `${base}/login#token=${encodeURIComponent(token)}`;
}

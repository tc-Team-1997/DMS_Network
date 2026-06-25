// SSO router: mounts ONLY the enabled providers and always exposes the public
// GET /auth/config so the login UI can render the right buttons. Disabled
// providers are never mounted; their would-be routes return
// 404 { error: "provider_disabled" } via a catch-all guard.

import { Router } from "express";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { loadAuthConfig, enabledProviders, type AuthConfig } from "./authConfig.js";
import { createSsoClients, type SsoClients } from "./clients.js";
import { mapAndIssue, type ExternalIdentity } from "./jit.js";

export interface SsoDeps {
  knex: Knex;
  config: AppConfig;
  authConfig?: AuthConfig;
  ssoClients?: SsoClients;
}

interface OidcTransient { state: string; nonce: string; codeVerifier: string; createdAt: number }

const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

/** Build the SSO router. Reads deps from app.locals at request time so tests can
 *  inject fake clients/authConfig without re-wiring. */
export function ssoRouter(): Router {
  const r = Router();
  // In-memory transient OIDC state store (single-node). For multi-node deploys
  // back this with Redis; the shape is intentionally minimal.
  const oidcStates = new Map<string, OidcTransient>();

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
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) { res.status(400).json({ error: "invalid_request" }); return; }
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
    const { authConfig, ssoClients } = deps(req);
    if (!authConfig.oidc.enabled) { res.status(404).json({ error: "provider_disabled" }); return; }
    try {
      const ar = await ssoClients.oidc.buildAuthRequest(authConfig.oidc);
      oidcStates.set(ar.state, { state: ar.state, nonce: ar.nonce, codeVerifier: ar.codeVerifier, createdAt: Date.now() });
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
    const transient = oidcStates.get(state);
    if (!code || !state || !transient || Date.now() - transient.createdAt > OIDC_STATE_TTL_MS) {
      res.status(400).json({ error: "invalid_state" }); return;
    }
    oidcStates.delete(state);
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

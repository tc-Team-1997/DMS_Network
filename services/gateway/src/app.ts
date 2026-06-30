import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { rolesRouter } from "./routes/roles.js";
import { securitySettingsRouter } from "./routes/securitySettings.js";
import { adminRouter } from "./routes/admin.js";
import { authzRouter } from "./routes/authz.js";
import { ssoRouter } from "./sso/index.js";
import { buildOpenApiDocument } from "./openapi.js";

export interface AppDeps { knex: Knex; config: AppConfig; }

export function createApp(deps: AppDeps): Express {
  const app = express();
  // Fix 7: restrict CORS to configured origin (env CORS_ORIGIN or dev default)
  app.use(cors({ origin: deps.config.corsOrigin }));
  app.use(express.json());
  // SAML ACS posts an application/x-www-form-urlencoded SAMLResponse.
  app.use(express.urlencoded({ extended: false }));
  // Parse signed/HttpOnly cookies. The OIDC login->callback flow stashes its
  // transient {state,nonce,codeVerifier} in a short-lived signed cookie so that
  // any gateway replica behind a load balancer can complete the callback
  // (stateless; see services/gateway/src/sso/index.ts).
  app.use(cookieParser());
  app.locals.deps = deps;

  // SSO routes mount under /auth alongside local login. The SSO router owns
  // /auth/config plus the per-provider login/callback routes; disabled providers
  // self-guard with 404 { error: "provider_disabled" } and never authenticate.
  app.use("/auth", ssoRouter());
  app.use("/auth", authRouter());
  app.use("/users", usersRouter());
  app.use("/roles", rolesRouter());
  app.use("/security-settings", securitySettingsRouter());
  app.use("/admin", adminRouter());
  app.use("/authz", authzRouter());
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // OpenAPI 3.1 contract, derived from the same zod schemas used for runtime
  // boundary validation. Built once at startup.
  const openApiDoc = buildOpenApiDocument();
  app.get("/openapi.json", (_req, res) => res.json(openApiDoc));
  // Raw spec alias.
  app.get("/openapi", (_req, res) => res.json(openApiDoc));
  return app;
}

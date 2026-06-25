import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
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
  app.locals.deps = deps;

  // SSO routes mount under /auth alongside local login. The SSO router owns
  // /auth/config plus the per-provider login/callback routes; disabled providers
  // self-guard with 404 { error: "provider_disabled" } and never authenticate.
  app.use("/auth", ssoRouter());
  app.use("/auth", authRouter());
  app.use("/users", usersRouter());
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

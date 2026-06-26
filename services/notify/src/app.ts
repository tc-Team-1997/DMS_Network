import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { errorHandler } from "@zordms/auth";
import type { ChannelRegistry } from "./channels/registry.js";
import type { EventBus } from "./bus/types.js";
import type { RealtimeHub } from "./realtime/hub.js";
import { healthRouter } from "./routes/health.js";
import { alertsRouter } from "./routes/alerts.js";
import { rulesRouter } from "./routes/rules.js";
import { streamRouter } from "./routes/stream.js";
import { templatesRouter } from "./routes/templates.js";
import { openapiRouter } from "./routes/openapi.js";

export interface NotifyDeps {
  knex: Knex;
  config: AppConfig;
  registry: ChannelRegistry;
  bus: EventBus;
  hub: RealtimeHub;
}

export function createApp(deps: NotifyDeps): Express {
  const app = express();
  app.use(cors({ origin: deps.config.corsOrigin ?? "*" }));
  app.use(express.json());
  app.locals.deps = deps;

  app.use("/health", healthRouter());
  app.use("/", openapiRouter());              // GET /openapi.json (+ /openapi)
  app.use("/alerts", streamRouter(deps.hub)); // SSE: GET /alerts/stream (auth-gated)
  app.use("/alerts", alertsRouter());         // REST: GET /alerts, POST /alerts/:id/read, etc.
  app.use("/rules", rulesRouter());
  app.use("/templates", templatesRouter());   // admin email-template CRUD + preview + test-send

  // Shared error handler from @zordms/auth (must be registered LAST)
  app.use(errorHandler);

  return app;
}

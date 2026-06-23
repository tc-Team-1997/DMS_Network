import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { ChannelRegistry } from "./channels/registry.js";
import type { EventBus } from "./bus/types.js";
import type { RealtimeHub } from "./realtime/hub.js";
import { healthRouter } from "./routes/health.js";
import { alertsRouter } from "./routes/alerts.js";
import { rulesRouter } from "./routes/rules.js";
import { streamRouter } from "./routes/stream.js";

export interface NotifyDeps {
  knex: Knex;
  config: AppConfig;
  registry: ChannelRegistry;
  bus: EventBus;
  hub: RealtimeHub;
}

export function createApp(deps: NotifyDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.locals.deps = deps;

  app.use("/health", healthRouter());
  app.use("/alerts", streamRouter(deps.hub)); // SSE: GET /alerts/stream
  app.use("/alerts", alertsRouter());         // REST: GET /alerts, POST /alerts/:id/read, etc.
  app.use("/rules", rulesRouter());

  return app;
}

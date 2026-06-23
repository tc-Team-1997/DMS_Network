import express, { type Express, type Request, type Response, type NextFunction } from "express";
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
  app.use(cors({ origin: deps.config.corsOrigin ?? "*" }));
  app.use(express.json());
  app.locals.deps = deps;

  app.use("/health", healthRouter());
  app.use("/alerts", streamRouter(deps.hub)); // SSE: GET /alerts/stream (auth-gated)
  app.use("/alerts", alertsRouter());         // REST: GET /alerts, POST /alerts/:id/read, etc.
  app.use("/rules", rulesRouter());

  // Global error handler — catches unhandled async exceptions from route handlers
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[notify] unhandled error", err);
    res.status(500).json({ error: "internal_server_error" });
  });

  return app;
}

import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { captureRawBody } from "./middleware/rawBody.js";
import type { EventSink } from "./events/sink.js";
import type { Connector } from "./connectors/types.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { outboundRouter } from "./routes/outbound.js";
import { managementRouter } from "./routes/management.js";

export interface AppDeps {
  knex: Knex;
  config: AppConfig;
  events?: EventSink;
  connectorFor?: (system: string) => Connector;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  // verify hook captures req.rawBody for every JSON request (used by webhook HMAC).
  app.use(express.json({ verify: captureRawBody }));
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "integration" }));

  app.use("/webhooks", webhooksRouter());
  app.use("/outbound", outboundRouter());
  app.use("/integration", managementRouter());

  return app;
}

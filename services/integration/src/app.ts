import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { errorHandler } from "@zordms/auth";
import { captureRawBody } from "./middleware/rawBody.js";
import type { EventSink } from "./events/sink.js";
import type { Connector } from "./connectors/types.js";
import type { CoreIngestClient } from "./core/ingest.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { outboundRouter } from "./routes/outbound.js";
import { managementRouter } from "./routes/management.js";
import { migrationRouter } from "./routes/migration.js";
import { buildOpenApiDocument } from "./openapi.js";

export interface AppDeps {
  knex: Knex;
  config: AppConfig;
  events?: EventSink;
  connectorFor?: (system: string) => Connector;
  // P7: optional core ingest client. When set, verified inbound webhooks are
  // forwarded to core's internal ingest endpoints. Absent in pure unit tests.
  coreIngest?: CoreIngestClient;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  // F3: Restrict CORS to the configured origin instead of wildcard.
  app.use(cors({ origin: deps.config.corsOrigin }));
  // verify hook captures req.rawBody for every JSON request (used by webhook HMAC).
  app.use(express.json({ verify: captureRawBody }));
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "integration" }));

  // P10: serve the OpenAPI 3.1 spec (built once at startup) and the raw spec.
  const openApiDoc = buildOpenApiDocument();
  app.get("/openapi.json", (_req, res) => res.json(openApiDoc));
  app.get("/openapi", (_req, res) => res.json(openApiDoc));

  app.use("/webhooks", webhooksRouter());
  app.use("/outbound", outboundRouter());
  app.use("/integration", managementRouter());
  app.use("/migration", migrationRouter());

  // F2: Global error handler — catches any error passed to next(err) from async handlers.
  // Must be registered AFTER routes (Express 4 signature must be exactly 4 args).
  app.use(errorHandler);

  return app;
}

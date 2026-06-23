import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { SearchBackend } from "./backend/SearchBackend.js";
import { reindexRouter } from "./routes/reindex.js";
import { searchRouter } from "./routes/search.js";
import { savedRouter } from "./routes/saved.js";
import { exportRouter } from "./routes/export.js";

export interface AppDeps {
  knex: Knex;
  config: AppConfig;
  backend?: SearchBackend;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.locals.deps = deps;

  const backend = deps.backend ?? { name: "sql" as const };

  app.get("/health", (_req, res) => res.json({ status: "ok", backend: backend.name }));
  app.use("/admin", reindexRouter());
  app.use("/", searchRouter());
  app.use("/saved", savedRouter());
  app.use("/", exportRouter());

  return app;
}

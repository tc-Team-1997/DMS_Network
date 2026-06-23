import express, { type Express, type Request, type Response, type NextFunction } from "express";
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
  backend: SearchBackend;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok", backend: deps.backend.name }));
  app.use("/admin", reindexRouter());
  app.use("/", searchRouter());
  app.use("/saved", savedRouter());
  app.use("/", exportRouter());

  // Global error handler — catches any error passed via next(err) from async handlers.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[search] unhandled error:", err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

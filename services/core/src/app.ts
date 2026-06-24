import express, { type Express } from "express";
import cors from "cors";
import { errorHandler } from "@zordms/auth";
import type { CoreDeps } from "./deps.js";
import { foldersRouter } from "./routes/folders.js";
import { documentsRouter } from "./routes/documents.js";
import { indexRouter } from "./routes/index.js";
import { annotationsRouter } from "./routes/annotations.js";
import { catalogRouter } from "./routes/catalog.js";
import { mapperRouter } from "./routes/mapper.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { branchesRouter } from "./routes/branches.js";
import { customersRouter } from "./routes/customers.js";
import { recordsRouter } from "./routes/records.js";
import { complianceRouter } from "./routes/compliance.js";
import { lifecycleRouter } from "./routes/lifecycle.js";
import { sysadminRouter } from "./routes/sysadmin.js";

export function createApp(deps: CoreDeps): Express {
  const app = express();
  // M2: restrict CORS to configured origin; fall back to same-origin only (no wildcard)
  const allowedOrigin = deps.config.corsOrigin;
  app.use(cors({ origin: allowedOrigin || false }));
  app.use(express.json());
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "core" }));

  app.use("/folders", foldersRouter());
  app.use("/documents", documentsRouter());
  app.use("/index", indexRouter());
  app.use("/documents/:documentId/annotations", annotationsRouter());
  app.use("/catalog", catalogRouter());
  app.use("/mapper", mapperRouter());
  app.use("/dashboard", dashboardRouter());

  // Enterprise Plan 8 routes
  app.use("/branches", branchesRouter());
  app.use("/customers", customersRouter());
  app.use("/records", recordsRouter());
  app.use("/compliance", complianceRouter());
  app.use("/lifecycle", lifecycleRouter());
  app.use("/admin", sysadminRouter());

  // I2: global error handler so unhandled async throws return 500 instead of hanging
  app.use(errorHandler);

  return app;
}

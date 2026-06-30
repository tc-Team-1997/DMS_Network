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
import { docTypesRouter } from "./routes/doc_types.js";
import { configRouter } from "./routes/config.js";
import { validationRouter } from "./routes/validation.js";
import { reportsRouter } from "./routes/reports.js";
import { aiConsoleRouter } from "./routes/aiConsole.js";
import { departmentsRouter } from "./routes/departments.js";
import { flowsRouter } from "./routes/flows.js";
import { extractionRouter } from "./routes/extraction.js";
import { integrationRouter } from "./routes/integration.js";
import { jobsRouter } from "./routes/jobs.js";
import { openapiRouter } from "./openapi/index.js";

export function createApp(deps: CoreDeps): Express {
  const app = express();
  // M2: restrict CORS to configured origin; fall back to same-origin only (no wildcard)
  const allowedOrigin = deps.config.corsOrigin;
  app.use(cors({ origin: allowedOrigin || false }));
  app.use(express.json());
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "core" }));

  // P10: serve the OpenAPI 3.1 spec (GET /openapi.json + raw /openapi)
  app.use(openapiRouter());

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
  app.use("/config", configRouter());
  app.use("/validation", validationRouter());
  app.use("/reports", reportsRouter());
  app.use("/ai-config", aiConsoleRouter());
  app.use("/departments", departmentsRouter());
  app.use("/flows", flowsRouter());

  // AI Ingestion + Classification pipeline
  app.use("/doc-types", docTypesRouter());
  app.use("/documents", extractionRouter());

  // P7: internal ingest endpoints called by the integration hub (x-internal-token auth)
  app.use("/integration", integrationRouter());

  // P8: durable job-queue status + admin monitor
  app.use("/jobs", jobsRouter());

  // I2: global error handler so unhandled async throws return 500 instead of hanging
  app.use(errorHandler);

  return app;
}

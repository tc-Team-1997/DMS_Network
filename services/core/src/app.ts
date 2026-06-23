import express, { type Express } from "express";
import cors from "cors";
import type { CoreDeps } from "./deps.js";
import { foldersRouter } from "./routes/folders.js";
import { documentsRouter } from "./routes/documents.js";
import { indexRouter } from "./routes/index.js";
import { annotationsRouter } from "./routes/annotations.js";
import { catalogRouter } from "./routes/catalog.js";
import { mapperRouter } from "./routes/mapper.js";
import { dashboardRouter } from "./routes/dashboard.js";

export function createApp(deps: CoreDeps): Express {
  const app = express();
  app.use(cors());
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

  return app;
}

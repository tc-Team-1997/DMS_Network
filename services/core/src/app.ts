import express, { type Express, type Request, type Response, type NextFunction } from "express";
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

  // I2: global error handler so unhandled async throws return 500 instead of hanging
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[core] unhandled error:", err);
    res.status(500).json({ error: "internal" });
  });

  return app;
}

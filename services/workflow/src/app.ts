import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { AuthorityClient } from "./authority.js";
import type { EventBus } from "./events.js";
import { workflowRouter, workflowsRouter } from "./routes/workflows.js";
import { casesRouter } from "./routes/cases.js";

export interface AppDeps {
  knex: Knex;
  config: AppConfig;
  authority?: AuthorityClient;
  events?: EventBus;
}

// F9: async wrapper so unhandled promise rejections in route handlers reach next(err).
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  // F8: restrict CORS to the configured origin (matching gateway pattern).
  app.use(cors({ origin: deps.config.corsOrigin }));
  app.use(express.json());
  app.locals.deps = deps;

  app.get("/health", (_req, res) =>
    res.json({ status: "ok", service: "workflow" }),
  );

  app.use("/", workflowRouter());
  app.use("/workflows", workflowsRouter());
  app.use("/cases", casesRouter());

  // F9: global async error handler — must be the last middleware (4-argument signature).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    console.error("workflow_error", err.message);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

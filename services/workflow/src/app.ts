import express, { type Express } from "express";
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

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.locals.deps = deps;

  app.get("/health", (_req, res) =>
    res.json({ status: "ok", service: "workflow" }),
  );

  app.use("/", workflowRouter());
  app.use("/workflows", workflowsRouter());
  app.use("/cases", casesRouter());

  return app;
}

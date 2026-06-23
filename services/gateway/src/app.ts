import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { authRouter } from "./routes/auth.js";

export interface AppDeps { knex: Knex; config: AppConfig; }

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.locals.deps = deps;

  app.use("/auth", authRouter());
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  return app;
}

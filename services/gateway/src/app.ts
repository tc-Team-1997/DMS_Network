import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { authzRouter } from "./routes/authz.js";

export interface AppDeps { knex: Knex; config: AppConfig; }

export function createApp(deps: AppDeps): Express {
  const app = express();
  // Fix 7: restrict CORS to configured origin (env CORS_ORIGIN or dev default)
  app.use(cors({ origin: deps.config.corsOrigin }));
  app.use(express.json());
  app.locals.deps = deps;

  app.use("/auth", authRouter());
  app.use("/users", usersRouter());
  app.use("/authz", authzRouter());
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  return app;
}

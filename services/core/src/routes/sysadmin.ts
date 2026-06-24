import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { serviceHealth, drPosture, schedules } from "../modules/sysadmin.js";
import type { CoreDeps } from "../deps.js";

export function sysadminRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.use(requirePermission("admin:access"));

  r.get("/health", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ health: await serviceHealth(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.get("/dr", (req, res) => {
    try {
      const { config } = req.app.locals.deps as CoreDeps;
      res.json({ dr: drPosture(config) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.get("/schedules", (_req, res) => res.json({ schedules: schedules() }));

  return r;
}

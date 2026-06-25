import { Router, type NextFunction, type Request, type Response } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { ConnectedSystem } from "@zordms/types";
import { LogsQuerySchema, parseOr400 } from "../validation.js";

export function managementRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // F2: Wrap async handlers in try/catch and pass errors to next(err).
  // P10: validate the key query params (system, limit) at the boundary.
  r.get("/logs", requirePermission("integration:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const query = parseOr400(LogsQuerySchema, req.query, res);
      if (!query) return;
      const { system, limit } = query;
      let q = knex("integration_logs").orderBy("id", "desc").limit(limit);
      if (system) q = q.where({ system });
      // Normalize SQLite boolean 0/1 to true/false for JSON serialization.
      const logs = (await q).map((l: any) => ({ ...l, success: Boolean(l.success) }));
      res.json({ logs });
    } catch (err) { next(err); }
  });

  r.get("/systems", requirePermission("integration:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const configs = await knex("integration_config").select("system", "base_url", "enabled");
      const systems: ConnectedSystem[] = [];
      for (const cfg of configs) {
        const recent = await knex("integration_logs").where({ system: cfg.system }).orderBy("id", "desc").limit(50);
        // Normalize SQLite boolean 0/1 to true/false before filtering.
        const recentErrors = recent.filter((l: any) => !l.success).length;
        const latest = recent[0];
        let status: ConnectedSystem["status"];
        if (!cfg.enabled) status = "disabled";
        else if (latest && !latest.success) status = "down";
        else status = "up";
        systems.push({
          system: cfg.system, base_url: cfg.base_url, enabled: Boolean(cfg.enabled),
          status, recentErrors, lastCallAt: latest?.created_at ?? null,
        });
      }
      res.json({ systems });
    } catch (err) { next(err); }
  });

  return r;
}

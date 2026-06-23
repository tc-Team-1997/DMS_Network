import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "../middleware/requireAuth.js";
import type { ConnectedSystem } from "../types.js";

export function managementRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/logs", requirePermission("integration:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const system = req.query.system as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    let q = knex("integration_logs").orderBy("id", "desc").limit(limit);
    if (system) q = q.where({ system });
    res.json({ logs: await q });
  });

  r.get("/systems", requirePermission("integration:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const configs = await knex("integration_config").select("system", "base_url", "enabled");
    const systems: ConnectedSystem[] = [];
    for (const cfg of configs) {
      const recent = await knex("integration_logs").where({ system: cfg.system }).orderBy("id", "desc").limit(50);
      const recentErrors = recent.filter((l: any) => !l.success).length;
      const latest = recent[0];
      let status: ConnectedSystem["status"];
      if (!cfg.enabled) status = "disabled";
      else if (latest && !latest.success) status = "down";
      else status = "up";
      systems.push({
        system: cfg.system, base_url: cfg.base_url, enabled: !!cfg.enabled,
        status, recentErrors, lastCallAt: latest?.created_at ?? null,
      });
    }
    res.json({ systems });
  });

  return r;
}

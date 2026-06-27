import { Router, type NextFunction, type Request, type Response } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { ConnectedSystem } from "@zordms/types";
import { LogsQuerySchema, SetInboundSecretSchema, UpsertConnectorSchema, parseOr400 } from "../validation.js";
import { newId } from "@zordms/db";
import { selectConnectorFromConfig } from "../connectors/registry.js";

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

  // Set/rotate the INBOUND HMAC secret for a connected system (admin RBAC).
  // `:id` is the system natural key (e.g. "cbs", "los") — the same key the
  // inbound webhook handler verifies signatures against. Lets each environment
  // configure its own secret instead of relying only on the seeded dev value.
  // The secret value itself is never echoed back in the response.
  r.put("/systems/:id/inbound-secret", requirePermission("integration:manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const body = parseOr400(SetInboundSecretSchema, req.body, res);
      if (!body) return;
      const system = req.params.id;
      const updated = await knex("integration_config").where({ system }).update({ secret: body.secret });
      if (!updated) {
        res.status(404).json({ error: "system_not_found" });
        return;
      }
      res.json({ system, inboundSecretSet: true });
    } catch (err) { next(err); }
  });

  // Admin upsert of a connector's config (base_url / auth_type / enabled / secret).
  // Config-driven: point e.g. cbs at a real BANCS/GBP endpoint without code change.
  // The secret is write-only and never returned.
  r.put("/systems/:id", requirePermission("integration:manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const body = parseOr400(UpsertConnectorSchema, req.body, res);
      if (!body) return;
      const system = req.params.id;
      const existing = await knex("integration_config").where({ system }).first();
      const patch: Record<string, unknown> = {};
      if (body.base_url !== undefined) patch.base_url = body.base_url;
      if (body.auth_type !== undefined) patch.auth_type = body.auth_type;
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.secret !== undefined) patch.secret = body.secret;
      if (existing) {
        if (Object.keys(patch).length) await knex("integration_config").where({ system }).update(patch);
      } else {
        await knex("integration_config").insert({
          id: newId(), system,
          base_url: (body.base_url as string | null) ?? null,
          auth_type: body.auth_type ?? "none",
          enabled: body.enabled ?? true,
          secret: body.secret ?? null,
        });
      }
      const saved = await knex("integration_config").where({ system }).first();
      res.json({ system, base_url: saved.base_url, auth_type: saved.auth_type, enabled: Boolean(saved.enabled), hasSecret: Boolean(saved.secret) });
    } catch (err) { next(err); }
  });

  // Test a connector: ping its health op (live) or report mock mode. Config-aware
  // (env base url → admin base url → mock).
  r.post("/systems/:id/test", requirePermission("integration:manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const system = req.params.id;
      const { connector, mode, baseUrl } = await selectConnectorFromConfig(system, { knex });
      const result = await connector.call("ping", {});
      res.json({ system, mode, baseUrl, ok: result.ok, status: result.status, error: result.error ?? null });
    } catch (err) { next(err); }
  });

  return r;
}

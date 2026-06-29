import { Router, type NextFunction, type Request, type Response } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { ConnectedSystem } from "@zordms/types";
import { LogsQuerySchema, SetInboundSecretSchema, CallConnectorSchema, parseOr400 } from "../validation.js";
import { selectConnector, OP_MAPS } from "../connectors/registry.js";

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

  // Invoke a connector op (outbound) — live HTTP when <SYSTEM>_BASE_URL is set,
  // else the canned mock. `op` is whitelisted against the system's OP_MAP so no
  // arbitrary path can be reached. The call is logged via withLogging. Returns
  // 200 on a successful connector result, 502 when the upstream/op failed.
  r.post("/systems/:system/call", requirePermission("integration:manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const system = req.params.system;
      const opMap = OP_MAPS[system];
      if (!opMap) { res.status(404).json({ error: "system_not_found" }); return; }
      const body = parseOr400(CallConnectorSchema, req.body, res);
      if (!body) return;
      if (!opMap[body.op]) {
        res.status(400).json({ error: "unknown_op", detail: `system '${system}' has no op '${body.op}'` });
        return;
      }
      const connector = selectConnector(system, { knex });
      const result = await connector.call(body.op, body.payload ?? {});
      res.status(result.ok ? 200 : 502).json({ system, op: body.op, result });
    } catch (err) { next(err); }
  });

  return r;
}

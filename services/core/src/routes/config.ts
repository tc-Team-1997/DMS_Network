import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { validateBody } from "../openapi/validate.js";
import { SetConfigSchema } from "../openapi/schemas.js";
import { listConfig, getConfig, setConfig } from "../repo/systemConfig.js";
import { writeAudit } from "../modules/audit.js";

/**
 * §4.13 Config module — audited runtime key/value settings.
 * Admin-only (admin:access), behind the gateway-issued JWT.
 */
export function configRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.use(requirePermission("admin:access"));

  // GET /config[?category=ai] — list all (optionally by category).
  r.get("/", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      res.json({ config: await listConfig(knex, category) });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // GET /config/:key — read one (404 if absent).
  r.get("/:key", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const entry = await getConfig(knex, req.params.key);
      if (!entry) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ config: entry });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // PUT /config/:key — upsert (audited).
  r.put("/:key", validateBody(SetConfigSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const entry = await setConfig(knex, {
        key: req.params.key,
        value: req.body.value,
        category: req.body.category,
        description: req.body.description,
        updatedBy: req.authUser!.username,
      });
      await writeAudit(knex, {
        actorId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        action: "CONFIG_SET",
        entity: "system_config",
        entityId: req.params.key,
        details: `set ${req.params.key}`,
      });
      res.json({ config: entry });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  return r;
}

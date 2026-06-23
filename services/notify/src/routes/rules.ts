import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { parseRule } from "../engine/ruleEngine.js";

export function rulesRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("alert:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const rows = await knex("alert_rules").orderBy("id", "desc");
    res.json({ rules: rows.map(parseRule) });
  });

  r.post("/", requirePermission("alert_rule:manage"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const b = req.body as { name: string; trigger: string; params?: object; channels?: string[]; escalationTarget?: string; scope?: string };
    const inserted = await knex("alert_rules").insert({
      name: b.name, trigger: b.trigger,
      params_json: JSON.stringify(b.params ?? {}),
      channels: JSON.stringify(b.channels ?? []),
      escalation_target: b.escalationTarget ?? null, scope: b.scope ?? null,
      enabled: true, created_by: req.authUser?.username ?? "system",
    }).returning("id");
    const id = Array.isArray(inserted)
      ? (typeof inserted[0] === "object" && inserted[0] !== null ? (inserted[0] as { id: number }).id : inserted[0] as number)
      : inserted;
    res.status(201).json({ id });
  });

  r.patch("/:id", requirePermission("alert_rule:manage"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const patch: Record<string, unknown> = {};
    const b = req.body as Record<string, unknown>;
    if (b.name !== undefined) patch.name = b.name;
    if (b.trigger !== undefined) patch.trigger = b.trigger;
    if (b.params !== undefined) patch.params_json = JSON.stringify(b.params);
    if (b.channels !== undefined) patch.channels = JSON.stringify(b.channels);
    if (b.escalationTarget !== undefined) patch.escalation_target = b.escalationTarget;
    if (b.scope !== undefined) patch.scope = b.scope;
    if (b.enabled !== undefined) patch.enabled = b.enabled;
    const n = await knex("alert_rules").where({ id: req.params.id }).update(patch);
    if (!n) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ok: true });
  });

  return r;
}

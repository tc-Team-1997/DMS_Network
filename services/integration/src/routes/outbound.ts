import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "../middleware/requireAuth.js";
import { dispatchEvent } from "../webhooks/dispatch.js";

export function outboundRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/", requirePermission("integration:manage"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { url, events, auth_method, secret } = req.body as
      { url: string; events: string[]; auth_method?: string; secret?: string };
    const [id] = await knex("outbound_webhooks").insert({
      url, events: (events ?? []).join(","), auth_method: auth_method ?? "hmac",
      secret: secret ?? null, enabled: true,
    }).returning("id");
    const webhookId = typeof id === "object" ? (id as any).id : id;
    res.status(201).json({ webhook: { id: webhookId, url, events: events ?? [], auth_method: auth_method ?? "hmac" } });
  });

  r.get("/", requirePermission("integration:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const rows = await knex("outbound_webhooks").select("id", "url", "events", "auth_method", "enabled");
    res.json({ webhooks: rows.map((w) => ({ ...w, events: String(w.events).split(",").filter(Boolean) })) });
  });

  r.post("/test", requirePermission("integration:manage"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { event, payload } = req.body as { event: string; payload?: unknown };
    const report = await dispatchEvent({ knex }, event, payload ?? {});
    res.json({ report });
  });

  return r;
}

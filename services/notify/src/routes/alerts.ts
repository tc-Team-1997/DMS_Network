import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { resolveEscalationRecipients } from "../services/escalation.js";
import type { ChannelRegistry } from "../channels/registry.js";

export function alertsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("alert:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    let q = knex("alerts").orderBy("id", "desc");
    if (req.query.level) q = q.where({ level: String(req.query.level) });
    if (req.query.unread === "true") q = q.where({ is_read: false });
    const rows = await q;
    const alerts = rows.map((a: any) => ({ ...a, is_read: Boolean(a.is_read) }));
    res.json({ alerts });
  });

  r.post("/:id/read", requirePermission("alert:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const n = await knex("alerts").where({ id: req.params.id }).update({ is_read: true });
    if (!n) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ok: true });
  });

  r.post("/:id/escalate", requirePermission("alert:manage"), async (req, res) => {
    const { knex, registry } = req.app.locals.deps as { knex: Knex; registry: ChannelRegistry };
    const alert = await knex("alerts").where({ id: req.params.id }).first();
    if (!alert) { res.status(404).json({ error: "not_found" }); return; }
    const target = String(req.body.target ?? "");
    if (!target) { res.status(400).json({ error: "target_required" }); return; }
    const recipients = await resolveEscalationRecipients([{ kind: "role", value: target }], { knex });
    for (const rcpt of recipients) {
      const [d] = await registry.dispatch(["email"], { recipient: rcpt.address, subject: `Escalated: ${alert.title}`, body: alert.title });
      await knex("notifications").insert({
        alert_id: alert.id, user_id: rcpt.userId ?? null, channel: "email",
        recipient: rcpt.address, subject: `Escalated: ${alert.title}`, body: alert.title,
        status: d.status, error: d.error ?? null,
      });
    }
    res.json({ escalatedTo: recipients.length });
  });

  return r;
}

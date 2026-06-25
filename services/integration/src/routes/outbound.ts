import { Router, type NextFunction, type Request, type Response } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { newId } from "@zordms/db";
import { dispatchEvent } from "../webhooks/dispatch.js";
import { CreateOutboundWebhookSchema, TestOutboundSchema, parseOr400 } from "../validation.js";

export function outboundRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // F2: Every async handler has try/catch and passes errors to next(err).
  // P10: Body parsed at the boundary with zod; 400 validation_error on bad input,
  // and the parsed/typed value is used downstream.
  r.post("/", requirePermission("integration:manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const body = parseOr400(CreateOutboundWebhookSchema, req.body, res);
      if (!body) return;
      const { url, events, auth_method, secret } = body;

      // Generate a UUIDv7 primary key and insert the webhook row explicitly.
      const id = newId();
      await knex("outbound_webhooks").insert({
        id, url, events: events.join(","), auth_method,
        secret: secret ?? null, enabled: true,
      });
      res.status(201).json({ webhook: { id, url, events, auth_method } });
    } catch (err) { next(err); }
  });

  r.get("/", requirePermission("integration:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const rows = await knex("outbound_webhooks").select("id", "url", "events", "auth_method", "enabled").orderBy("id", "desc");
      res.json({ webhooks: rows.map((w) => ({ ...w, events: String(w.events).split(",").filter(Boolean) })) });
    } catch (err) { next(err); }
  });

  // P10: Body parsed at the boundary with zod; 400 validation_error on bad input.
  r.post("/test", requirePermission("integration:manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const body = parseOr400(TestOutboundSchema, req.body, res);
      if (!body) return;
      const report = await dispatchEvent({ knex }, body.event, body.payload ?? {});
      res.json({ report });
    } catch (err) { next(err); }
  });

  return r;
}

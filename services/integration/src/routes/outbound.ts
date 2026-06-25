import { Router, type NextFunction, type Request, type Response } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { newId } from "@zordms/db";
import { dispatchEvent } from "../webhooks/dispatch.js";

export function outboundRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // F2: Every async handler has try/catch and passes errors to next(err).
  // F4: Validate required fields before touching the DB; return 400 on bad input.
  // F8 (minor): Treat empty or missing events array as 400 so callers are warned early.
  r.post("/", requirePermission("integration:manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const { url, events, auth_method, secret } = req.body as
        { url?: unknown; events?: unknown; auth_method?: string; secret?: string };

      // Validate required fields
      if (!url || typeof url !== "string") {
        res.status(400).json({ error: "url is required and must be a string" });
        return;
      }
      if (!Array.isArray(events) || events.length === 0) {
        res.status(400).json({ error: "events is required and must be a non-empty array" });
        return;
      }

      // Generate a UUIDv7 primary key and insert the webhook row explicitly.
      const id = newId();
      await knex("outbound_webhooks").insert({
        id, url, events: events.join(","), auth_method: auth_method ?? "hmac",
        secret: secret ?? null, enabled: true,
      });
      res.status(201).json({ webhook: { id, url, events, auth_method: auth_method ?? "hmac" } });
    } catch (err) { next(err); }
  });

  r.get("/", requirePermission("integration:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const rows = await knex("outbound_webhooks").select("id", "url", "events", "auth_method", "enabled").orderBy("id", "desc");
      res.json({ webhooks: rows.map((w) => ({ ...w, events: String(w.events).split(",").filter(Boolean) })) });
    } catch (err) { next(err); }
  });

  // F9 (minor): Validate that event field is present; return 400 otherwise.
  r.post("/test", requirePermission("integration:manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const { event, payload } = req.body as { event?: unknown; payload?: unknown };
      if (!event || typeof event !== "string") {
        res.status(400).json({ error: "event is required and must be a string" });
        return;
      }
      const report = await dispatchEvent({ knex }, event, payload ?? {});
      res.json({ report });
    } catch (err) { next(err); }
  });

  return r;
}

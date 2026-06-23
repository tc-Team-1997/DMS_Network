import { Router, type Request, type Response, type NextFunction } from "express";
import type { Knex } from "knex";
import type { EventSink } from "../events/sink.js";
import { verifySignature } from "../webhooks/hmac.js";

const SIGNATURE_HEADER = "x-zordms-signature";

interface Hook { system: string; event: string; }

async function handle(req: Request, res: Response, hook: Hook): Promise<void> {
  const deps = req.app.locals.deps as { knex: Knex; events?: EventSink };
  const { knex, events } = deps;

  // F6: Reject immediately when rawBody is absent — a fallback re-serialization would
  // never match the sender's HMAC and produces a misleading "invalid_signature" error.
  if (!req.rawBody) {
    res.status(400).json({ error: "raw_body_unavailable" });
    return;
  }

  const cfg = await knex("integration_config").where({ system: hook.system }).first();
  const secret = cfg?.secret as string | undefined;
  const raw = req.rawBody;
  const header = req.headers[SIGNATURE_HEADER] as string | undefined;

  if (!secret || !verifySignature(raw, secret, header)) {
    await knex("integration_logs").insert({
      system: hook.system, endpoint: hook.event, method: "POST",
      status: 401, latency_ms: 0, direction: "inbound", success: false, error: "bad_signature",
    });
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  // emit the internal event for Workflow/Notify consumers
  await events?.emit(hook.event, req.body);
  // durable hand-off record (Workflow/Notify also read the event bus in production)
  await knex("integration_logs").insert({
    system: hook.system, endpoint: hook.event, method: "POST",
    status: 202, latency_ms: 0, direction: "inbound", success: true,
  });
  res.status(202).json({ accepted: true, event: hook.event });
}

export function webhooksRouter(): Router {
  const r = Router();

  // F1: Outer handlers are async and await the inner `handle()` call so that any
  // rejection is passed to next(err) rather than becoming an unhandled Promise.
  r.post("/cbs/customer-updated", async (req: Request, res: Response, next: NextFunction) => {
    try { await handle(req, res, { system: "cbs", event: "cbs.customer.updated" }); }
    catch (err) { next(err); }
  });
  r.post("/los/loan-application", async (req: Request, res: Response, next: NextFunction) => {
    try { await handle(req, res, { system: "los", event: "los.loan.created" }); }
    catch (err) { next(err); }
  });
  r.post("/kyc/verification-result", async (req: Request, res: Response, next: NextFunction) => {
    try { await handle(req, res, { system: "kyc", event: "kyc.result" }); }
    catch (err) { next(err); }
  });

  return r;
}

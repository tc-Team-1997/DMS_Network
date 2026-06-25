import { Router, type Request, type Response, type NextFunction } from "express";
import type { Knex } from "knex";
import { newId } from "@zordms/db";
import type { EventSink } from "../events/sink.js";
import type { CoreIngestClient } from "../core/ingest.js";
import { pathForEvent } from "../core/ingest.js";
import { verifySignature } from "../webhooks/hmac.js";
import { InboundSchemaForEvent, parseOr400 } from "../validation.js";

const SIGNATURE_HEADER = "x-zordms-signature";

interface Hook { system: string; event: string; }

async function handle(req: Request, res: Response, hook: Hook): Promise<void> {
  const deps = req.app.locals.deps as { knex: Knex; events?: EventSink; coreIngest?: CoreIngestClient };
  const { knex, events, coreIngest } = deps;

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
      id: newId(), system: hook.system, endpoint: hook.event, method: "POST",
      status: 401, latency_ms: 0, direction: "inbound", success: false, error: "bad_signature",
    });
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  // P10: validate the inbound payload AFTER the signature is trusted (so a bad
  // signature still returns 401, not 400). The parsed/typed value is used
  // downstream for emit + core forwarding.
  const schema = InboundSchemaForEvent[hook.event];
  let payload: unknown = req.body;
  if (schema) {
    const parsed = parseOr400(schema, req.body, res);
    if (parsed === undefined) {
      await knex("integration_logs").insert({
        id: newId(), system: hook.system, endpoint: hook.event, method: "POST",
        status: 400, latency_ms: 0, direction: "inbound", success: false, error: "validation_error",
      });
      return;
    }
    payload = parsed;
  }

  // emit the internal event for Workflow/Notify consumers
  await events?.emit(hook.event, payload);

  // P7: forward verified inbound events to CORE's internal ingest endpoint so the
  // data is actually persisted (CBS customer-updated -> customer upsert,
  // LOS loan-application -> loan intake). Best-effort: a brief core outage must
  // NOT 500 the sender — we record consumed=false (+ error) and still 202.
  // `consumed` is null when the event has no core ingest route (e.g. kyc.result).
  let consumed: boolean | null = pathForEvent(hook.event) ? false : null;
  let consumeError: string | null = null;
  if (coreIngest && consumed === false) {
    const result = await coreIngest.forward(hook.event, payload);
    consumed = result.ok;
    consumeError = result.ok ? null : (result.error ?? `http_${result.status}`);
  }

  // durable hand-off record (Workflow/Notify also read the event bus in production)
  await knex("integration_logs").insert({
    id: newId(), system: hook.system, endpoint: hook.event, method: "POST",
    status: 202, latency_ms: 0, direction: "inbound", success: true,
    consumed, error: consumeError,
  });
  res.status(202).json({ accepted: true, event: hook.event, consumed });
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

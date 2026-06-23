import { Router, type Request, type Response } from "express";
import type { Knex } from "knex";
import type { EventSink } from "../events/sink.js";
import { verifySignature } from "../webhooks/hmac.js";

const SIGNATURE_HEADER = "x-zordms-signature";

interface Hook { system: string; event: string; }

async function handle(req: Request, res: Response, hook: Hook): Promise<void> {
  const deps = req.app.locals.deps as { knex: Knex; events?: EventSink };
  const { knex, events } = deps;
  const cfg = await knex("integration_config").where({ system: hook.system }).first();
  const secret = cfg?.secret as string | undefined;
  const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
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
  r.post("/cbs/customer-updated", (req, res) => handle(req, res, { system: "cbs", event: "cbs.customer.updated" }));
  r.post("/los/loan-application", (req, res) => handle(req, res, { system: "los", event: "los.loan.created" }));
  r.post("/kyc/verification-result", (req, res) => handle(req, res, { system: "kyc", event: "kyc.result" }));
  return r;
}

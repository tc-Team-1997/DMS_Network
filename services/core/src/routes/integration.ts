import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import type { CoreDeps } from "../deps.js";
import { validateBody } from "../openapi/validate.js";
import { CustomerUpsertSchema, LoanIntakeSchema } from "../openapi/schemas.js";

/**
 * P7: Internal ingest endpoints called by the INTEGRATION hub (service-to-service)
 * after it verifies an inbound external webhook's HMAC. Authentication is via the
 * shared INTERNAL_SERVICE_TOKEN (x-internal-token), NOT a user JWT — same pattern
 * the workflow service uses to call the gateway's /authz/check.
 *
 * Upserts are idempotent (keyed by CID / external application ref) and the
 * response reports what changed ("created" | "updated").
 */

// Constant-time token comparison (mirrors gateway/src/routes/authz.ts).
function internalTokenValid(provided: unknown, expected: string): boolean {
  if (!expected || expected.length === 0) return false;
  const p = String(provided ?? "");
  if (p.length !== expected.length) return false;
  const a = Buffer.from(p);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function integrationRouter(): Router {
  const r = Router();

  // Service-token guard for every route on this router.
  r.use((req: Request, res: Response, next: NextFunction) => {
    const { config } = req.app.locals.deps as CoreDeps;
    if (!internalTokenValid(req.headers["x-internal-token"], config.internalServiceToken)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  // CBS customer-updated -> upsert Customer 360 master record (idempotent by cid).
  r.post("/customer-upsert", validateBody(CustomerUpsertSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const body = req.body as {
        cid?: unknown; name?: unknown; branch?: unknown; segment?: unknown; kycStatus?: unknown; kyc_status?: unknown;
      };
      const cid = typeof body.cid === "string" ? body.cid.trim() : "";
      if (!cid) { res.status(400).json({ error: "cid_required" }); return; }

      const patch: Record<string, unknown> = { updated_at: knex.fn.now() };
      if (typeof body.name === "string") patch.name = body.name;
      if (typeof body.branch === "string") patch.branch = body.branch;
      if (typeof body.segment === "string") patch.segment = body.segment;
      const kyc = typeof body.kycStatus === "string" ? body.kycStatus
        : typeof body.kyc_status === "string" ? body.kyc_status : undefined;
      if (kyc !== undefined) patch.kyc_status = kyc;

      const existing = await knex("customers").where({ cid }).first();
      if (existing) {
        await knex("customers").where({ cid }).update(patch);
        res.status(200).json({ change: "updated", cid });
      } else {
        await knex("customers").insert({ cid, source: "cbs", ...patch });
        res.status(201).json({ change: "created", cid });
      }
    } catch (err) { next(err); }
  });

  // LOS loan-application -> upsert a loan intake case stub + customer link (idempotent by applicationId).
  r.post("/loan-intake", validateBody(LoanIntakeSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const body = req.body as {
        applicationId?: unknown; application_id?: unknown; cid?: unknown;
        amount?: unknown; product?: unknown; state?: unknown;
      };
      const appId = typeof body.applicationId === "string" ? body.applicationId.trim()
        : typeof body.application_id === "string" ? body.application_id.trim() : "";
      if (!appId) { res.status(400).json({ error: "application_id_required" }); return; }

      const patch: Record<string, unknown> = { updated_at: knex.fn.now() };
      if (typeof body.cid === "string") patch.cid = body.cid;
      if (typeof body.amount === "number") patch.amount = body.amount;
      if (typeof body.product === "string") patch.product = body.product;
      if (typeof body.state === "string") patch.state = body.state;

      const existing = await knex("loan_intakes").where({ application_id: appId }).first();
      if (existing) {
        await knex("loan_intakes").where({ application_id: appId }).update(patch);
        res.status(200).json({ change: "updated", applicationId: appId });
      } else {
        await knex("loan_intakes").insert({ application_id: appId, source: "los", ...patch });
        res.status(201).json({ change: "created", applicationId: appId });
      }
    } catch (err) { next(err); }
  });

  return r;
}

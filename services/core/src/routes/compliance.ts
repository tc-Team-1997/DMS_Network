import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { REGULATORY_MATRIX, complianceScorecard, queryAuditTrail, verifyAuditChain } from "../modules/compliance.js";
import type { CoreDeps } from "../deps.js";
import { validateQuery } from "../openapi/validate.js";
import { AuditQuerySchema } from "../openapi/schemas.js";

export function complianceRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.use(requirePermission("compliance:read"));

  r.get("/scorecard", (_req, res) => res.json({ scorecard: complianceScorecard(REGULATORY_MATRIX) }));
  r.get("/matrix", (_req, res) => res.json({ matrix: REGULATORY_MATRIX }));

  r.get("/audit", validateQuery(AuditQuerySchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const q = (req as any).validatedQuery as {
        action?: string; entity?: string; actor?: string; limit?: number;
      };
      const rows = await queryAuditTrail(knex, {
        action: q.action,
        entity: q.entity,
        actor: q.actor,
        limit: q.limit,
      });
      res.json({ rows });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.get("/verify", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ verification: await verifyAuditChain(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  return r;
}

import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware.js";
import { REGULATORY_MATRIX, complianceScorecard, queryAuditTrail, verifyAuditChain } from "../modules/compliance.js";
import type { CoreDeps } from "../deps.js";

export function complianceRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.use(requirePermission("compliance:read"));

  r.get("/scorecard", (_req, res) => res.json({ scorecard: complianceScorecard(REGULATORY_MATRIX) }));
  r.get("/matrix", (_req, res) => res.json({ matrix: REGULATORY_MATRIX }));

  r.get("/audit", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const rows = await queryAuditTrail(knex, {
        action: req.query.action as string | undefined,
        entity: req.query.entity as string | undefined,
        actor: req.query.actor as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
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

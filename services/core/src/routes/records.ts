import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware.js";
import {
  listFilePlan, listLegalHolds, placeLegalHold, releaseLegalHold, disposalEligibility, certifiedDisposal,
} from "../modules/records.js";
import type { CoreDeps } from "../deps.js";

export function recordsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/file-plan", requirePermission("compliance:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ policies: await listFilePlan(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.get("/holds", requirePermission("compliance:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ holds: await listLegalHolds(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.post("/holds", requirePermission("legal_hold:place"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const { ref, scope } = req.body ?? {};
      if (!ref || !scope) { res.status(400).json({ error: "ref_and_scope_required" }); return; }
      res.status(201).json({ hold: await placeLegalHold(knex, { ref, scope, placed_by: req.authUser!.username }) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.post("/holds/:ref/release", requirePermission("legal_hold:place"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ hold: await releaseLegalHold(knex, req.params.ref) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.get("/disposal/eligibility", requirePermission("compliance:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ candidates: await disposalEligibility(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.post("/disposal/:documentId/certify", requirePermission("document:delete"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const result = await certifiedDisposal(knex, Number(req.params.documentId), req.authUser!.username);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(409).json({ error: String(err.message ?? err) });
    }
  });

  return r;
}

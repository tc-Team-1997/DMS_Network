import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import {
  listFilePlan, listLegalHolds, placeLegalHold, releaseLegalHold, disposalEligibility, certifiedDisposal,
  upsertRetentionPolicy, updateRetentionPolicy, deleteRetentionPolicy,
  LegalHoldError,
} from "../modules/records.js";
import type { CoreDeps } from "../deps.js";
import { validateBody } from "../openapi/validate.js";
import { PlaceHoldSchema, CreateRetentionRuleSchema, UpdateRetentionRuleSchema } from "../openapi/schemas.js";

export function recordsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/file-plan", requirePermission("compliance:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ policies: await listFilePlan(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // SC-06: create/update/delete retention rules.
  r.post("/file-plan", requirePermission("admin:access"), validateBody(CreateRetentionRuleSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const policy = await upsertRetentionPolicy(knex, {
        docClass: req.body.doc_class, retentionYears: req.body.retention_years,
        trigger: req.body.trigger, regulation: req.body.regulation,
      }, req.authUser!.username);
      res.status(201).json({ policy });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  r.put("/file-plan/:id", requirePermission("admin:access"), validateBody(UpdateRetentionRuleSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const policy = await updateRetentionPolicy(knex, req.params.id, {
        retentionYears: req.body.retention_years, trigger: req.body.trigger, regulation: req.body.regulation,
      }, req.authUser!.username);
      if (!policy) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ policy });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  r.delete("/file-plan/:id", requirePermission("admin:access"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const ok = await deleteRetentionPolicy(knex, req.params.id, req.authUser!.username);
      if (!ok) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ deleted: true });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  r.get("/holds", requirePermission("compliance:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ holds: await listLegalHolds(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.post("/holds", requirePermission("legal_hold:place"), validateBody(PlaceHoldSchema), async (req, res) => {
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
      const result = await certifiedDisposal(knex, req.params.documentId, req.authUser!.username);
      res.status(201).json(result);
    } catch (err: any) {
      if (err instanceof LegalHoldError) {
        res.status(409).json({ error: "under_legal_hold", hold: err.hold });
        return;
      }
      res.status(409).json({ error: String(err.message ?? err) });
    }
  });

  return r;
}

import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { validateBody } from "../openapi/validate.js";
import { CreateValidationRuleSchema, UpdateValidationRuleSchema, RunValidationSchema } from "../openapi/schemas.js";
import { listRules, createRule, updateRule, deleteRule, runValidation, listResults } from "../repo/validation.js";
import { writeAudit } from "../modules/audit.js";

/**
 * §4.6 Validation module — data-driven field validation.
 * Admin-only (admin:access), behind the gateway-issued JWT.
 */
export function validationRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.use(requirePermission("admin:access"));

  // ── Rules CRUD ────────────────────────────────────────────────────────────
  r.get("/rules", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const docType = typeof req.query.doc_type === "string" ? req.query.doc_type : undefined;
      res.json({ rules: await listRules(knex, docType) });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  r.post("/rules", validateBody(CreateValidationRuleSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const rule = await createRule(knex, {
        docType: req.body.doc_type ?? null,
        fieldKey: req.body.field_key,
        ruleType: req.body.rule_type,
        params: req.body.params,
        severity: req.body.severity,
        message: req.body.message,
        enabled: req.body.enabled,
        createdBy: req.authUser!.username,
      });
      res.status(201).json({ rule });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  r.put("/rules/:id", validateBody(UpdateValidationRuleSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const rule = await updateRule(knex, req.params.id, {
        docType: req.body.doc_type,
        fieldKey: req.body.field_key,
        ruleType: req.body.rule_type,
        params: req.body.params,
        severity: req.body.severity,
        message: req.body.message,
        enabled: req.body.enabled,
      });
      if (!rule) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ rule });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  r.delete("/rules/:id", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const ok = await deleteRule(knex, req.params.id);
      if (!ok) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ deleted: true });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // ── Run + results ───────────────────────────────────────────────────────────
  r.post("/run", validateBody(RunValidationSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const out = await runValidation(knex, {
        documentId: req.body.documentId,
        docType: req.body.doc_type,
        data: req.body.data ?? {},
      });
      if (req.body.documentId) {
        await writeAudit(knex, {
          actorId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          action: "VALIDATION_RUN",
          entity: "document",
          entityId: req.body.documentId,
          details: `validation ${out.summary.passed}/${out.summary.total} passed`,
        });
      }
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  r.get("/results", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const documentId = typeof req.query.document_id === "string" ? req.query.document_id : "";
      if (!documentId) { res.status(400).json({ error: "document_id required" }); return; }
      res.json({ results: await listResults(knex, documentId) });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  return r;
}

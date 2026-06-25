/**
 * GET /doc-types — Document Type Registry
 *
 * Returns the known document types from the doc_type_registry table.
 * Each type includes mandatoryFields and optionalFields derived from
 * the catalog engine (MANDATORY per category) and per-type extras.
 *
 * Public read (still requires auth); no special permission needed beyond requireAuth.
 */
import { Router } from "express";
import { requireAuth } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { fieldSchemaForType } from "../catalog/quality.js";

export function docTypesRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;

      // Fetch registry rows
      const registryRows = await knex("doc_type_registry")
        .select("code", "description", "jurisdiction", "issuer", "category", "system", "created_at")
        .orderBy("code");

      // Also pick up any doc_type values that are in documents but not in registry
      const dynamicRows = await knex("documents")
        .select("doc_type")
        .whereNotNull("doc_type")
        .whereNot("doc_type", "")
        .whereNotIn("doc_type", registryRows.map((r: any) => r.code))
        .groupBy("doc_type");

      const dynamic = dynamicRows.map((d: any) => ({
        code: d.doc_type as string,
        description: `Observed in documents (not yet registered)`,
        jurisdiction: "ANY",
        issuer: "Unknown",
        category: null,
        system: false,
        created_at: null,
      }));

      const allTypes = [...registryRows, ...dynamic];

      // Attach field schema to each type
      const docTypesWithSchema = allTypes.map((dt: any) => {
        const { mandatoryFields, optionalFields } = fieldSchemaForType(dt.code, dt.category);
        return { ...dt, mandatoryFields, optionalFields };
      });

      res.json({
        docTypes: docTypesWithSchema,
        total: docTypesWithSchema.length,
      });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  return r;
}

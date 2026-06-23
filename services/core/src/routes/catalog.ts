import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware.js";
import { EVENTS } from "../events/index.js";
import type { CoreDeps } from "../deps.js";
import { catalog } from "../catalog/engine.js";
import { getDocument } from "../repo/documents.js";

function addYears(iso: string, years: number): string {
  if (years >= 9999) return "9999-12-31";
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export function catalogRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/:documentId", requirePermission("document:catalog"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.documentId));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }

    const result = catalog({
      docType: req.body.docType,
      confidence: Number(req.body.confidence ?? 1),
      fields: req.body.fields ?? {},
    });

    if (result.route !== "HUMAN_REVIEW") {
      const ingest = (document.ingest_timestamp as string | undefined) ?? new Date().toISOString();
      await deps.knex("documents").where({ id: document.id }).update({
        catalog_category: result.category,
        retention_years: result.retentionYears,
        destruction_date: addYears(ingest, result.retentionYears),
        review_flag: result.reviewFlag ?? document.review_flag,
      });
      await deps.events.emit(EVENTS.DOCUMENT_CATALOGED, {
        docId: document.id,
        category: result.category,
        route: result.route,
      });
    }

    res.json({ result });
  });

  return r;
}

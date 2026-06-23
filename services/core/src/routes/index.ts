import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware.js";
import { EVENTS } from "../events/index.js";
import type { CoreDeps } from "../deps.js";
import { validateMetadata } from "../schemas/index.js";
import { getDocument } from "../repo/documents.js";

export function indexRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/:documentId", requirePermission("document:index"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.documentId));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }

    const body = req.body;
    const result = validateMetadata(body.doc_type, body.fields ?? {});
    if (!result.ok) { res.status(422).json({ errors: result.errors, missing: result.missing }); return; }

    const confidence = typeof body.confidence === "number" ? body.confidence : 1;
    const reviewFlag = confidence < 0.85;
    await deps.knex("documents").where({ id: document.id }).update({
      doc_type: body.doc_type,
      metadata: JSON.stringify(body.fields),
      confidence,
      review_flag: reviewFlag,
    });
    await deps.events.emit(EVENTS.DOCUMENT_INDEXED, { docId: document.id, docType: body.doc_type, confidence });
    const updated = await deps.knex("documents").where({ id: document.id }).first();
    // Normalize SQLite boolean (0/1) to JS boolean
    res.json({ document: { ...updated, review_flag: Boolean(updated.review_flag) } });
  });

  return r;
}

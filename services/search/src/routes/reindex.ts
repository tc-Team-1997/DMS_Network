import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { SearchBackend } from "../backend/SearchBackend.js";
import { ReindexRequestSchema, parseOrFail } from "../schemas.js";
import { reindexFromCorpus } from "../reindex.js";

export function reindexRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.post("/reindex", requirePermission("admin:access"), async (req, res, next) => {
    try {
      const { backend, knex } = req.app.locals.deps as { backend: SearchBackend; knex: Knex };
      // Boundary validation of the envelope shape (docs array + field types).
      const parsed = parseOrFail(ReindexRequestSchema, req.body ?? {}, res);
      if (!parsed) return;
      const docs = parsed.docs;

      // No docs supplied -> backfill from the local search_index corpus. This is
      // the path used to populate an empty Elasticsearch cluster from existing data.
      if (docs.length === 0) {
        const { indexed } = await reindexFromCorpus(knex, backend);
        res.json({ reindexed: indexed });
        return;
      }

      // Business rule: doc_id must be present & non-empty — returns a specific error.
      for (const doc of docs) {
        if (doc.doc_id.trim() === "") {
          res.status(400).json({ error: "invalid_doc", detail: "Each doc must have a non-empty doc_id" });
          return;
        }
      }
      const reindexed = await backend.reindexAll(docs);
      res.json({ reindexed });
    } catch (err) { next(err); }
  });
  return r;
}

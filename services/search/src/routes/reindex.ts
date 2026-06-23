import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import type { SearchBackend } from "../backend/SearchBackend.js";
import type { SearchDoc } from "../types.js";

export function reindexRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.post("/reindex", requirePermission("admin:access"), async (req, res, next) => {
    try {
      const { backend } = req.app.locals.deps as { backend: SearchBackend };
      const docs = (req.body?.docs ?? []) as SearchDoc[];
      // Validate required fields per document to avoid DB errors on missing doc_id.
      for (const doc of docs) {
        if (!doc.doc_id || typeof doc.doc_id !== "string" || doc.doc_id.trim() === "") {
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

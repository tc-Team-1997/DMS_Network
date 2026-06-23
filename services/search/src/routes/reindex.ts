import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import type { SearchBackend } from "../backend/SearchBackend.js";
import type { SearchDoc } from "../types.js";

export function reindexRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.post("/reindex", requirePermission("admin:access"), async (req, res) => {
    const { backend } = req.app.locals.deps as { backend: SearchBackend };
    const docs = (req.body?.docs ?? []) as SearchDoc[];
    const reindexed = await backend.reindexAll(docs);
    res.json({ reindexed });
  });
  return r;
}

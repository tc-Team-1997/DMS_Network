import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware.js";
import { buildLifecycleTrace } from "../modules/lifecycle.js";
import type { CoreDeps } from "../deps.js";

export function lifecycleRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.get("/:docId", requirePermission("document:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ trace: await buildLifecycleTrace(knex, Number(req.params.docId)) });
    } catch (err: any) {
      res.status(404).json({ error: String(err.message ?? err) });
    }
  });
  return r;
}

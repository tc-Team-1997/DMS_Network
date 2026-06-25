import { Router } from "express";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { SearchScope } from "@zordms/types";
import type { SearchBackend } from "../backend/SearchBackend.js";
import { SearchQuerySchema, parseOrFail } from "../schemas.js";

export function viewerToScope(viewer: { branch?: string; canCrossBranch: boolean }): SearchScope {
  return {
    branch: viewer.branch,
    crossBranch: viewer.canCrossBranch,
  };
}

export function searchRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/search", requirePermission("document:read"), async (req, res, next) => {
    try {
      const { backend } = req.app.locals.deps as { backend: SearchBackend };
      const body = parseOrFail(SearchQuerySchema, req.body, res);
      if (!body) return;
      const results = await backend.search(body, viewerToScope(makeViewer(req)));
      res.json(results);
    } catch (err) { next(err); }
  });

  r.get("/facets", requirePermission("document:read"), async (req, res, next) => {
    try {
      const { backend } = req.app.locals.deps as { backend: SearchBackend };
      const results = await backend.search({ text: "", mode: "fulltext", pageSize: 1 }, viewerToScope(makeViewer(req)));
      res.json({ facets: results.facets ?? {} });
    } catch (err) { next(err); }
  });

  return r;
}

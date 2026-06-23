import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { isSearchQuery, type SearchQuery, type SearchScope } from "../types.js";
import type { AuthUser } from "@zordms/types";
import type { SearchBackend } from "../backend/SearchBackend.js";

export function scopeFromUser(user: AuthUser): SearchScope {
  return {
    branch: user.branch,
    region: user.region,
    crossBranch: user.permissions.includes("crossbranch:read"),
  };
}

export function searchRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/search", requirePermission("document:read"), async (req, res) => {
    const { backend } = req.app.locals.deps as { backend: SearchBackend };
    const body = req.body as SearchQuery;
    if (!isSearchQuery(body)) { res.status(400).json({ error: "invalid_query" }); return; }
    const results = await backend.search(body, scopeFromUser(req.authUser!));
    res.json(results);
  });

  r.get("/facets", requirePermission("document:read"), async (req, res) => {
    const { backend } = req.app.locals.deps as { backend: SearchBackend };
    const results = await backend.search({ text: "", mode: "fulltext", pageSize: 1 }, scopeFromUser(req.authUser!));
    res.json({ facets: results.facets ?? {} });
  });

  return r;
}

import { Router } from "express";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { SearchHit } from "@zordms/types";
import type { SearchBackend } from "../backend/SearchBackend.js";
import { viewerToScope } from "./search.js";
import { SearchQuerySchema, parseOrFail } from "../schemas.js";

const COLUMNS: Array<keyof SearchHit> = ["doc_id", "doc_type", "branch", "status", "score", "indexed_at"];
const EXPORT_CAP = 5000;

function cell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(hits: SearchHit[]): string {
  const header = COLUMNS.join(",");
  const rows = hits.map((h) => COLUMNS.map((c) => cell(h[c])).join(","));
  return [header, ...rows].join("\n") + "\n";
}

export function exportRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.post("/search/export.csv", requirePermission("document:read"), async (req, res, next) => {
    try {
      const { backend } = req.app.locals.deps as { backend: SearchBackend };
      const body = parseOrFail(SearchQuerySchema, req.body, res);
      if (!body) return;
      const results = await backend.search({ ...body, page: 1, pageSize: EXPORT_CAP }, viewerToScope(makeViewer(req)));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="zordms-search.csv"');
      res.send(toCsv(results.hits));
    } catch (err) { next(err); }
  });
  return r;
}

import { Router } from "express";
import type { Knex } from "knex";
import { newId } from "@zordms/db";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { SearchQuery } from "@zordms/types";
import { isSearchQuery } from "@zordms/types";
import type { SearchBackend } from "../backend/SearchBackend.js";
import { viewerToScope } from "./search.js";
import { SaveSearchRequestSchema, SavedSearchIdParamsSchema, parseOrFail } from "../schemas.js";

export function savedRouter(): Router {
  const r = Router();
  r.use(requireAuth, requirePermission("document:read"));

  r.post("/", async (req, res, next) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const body = parseOrFail(SaveSearchRequestSchema, req.body, res);
      if (!body) return;
      const visibility = body.visibility === "public" ? "public" : "private";
      const savedId = newId();
      await knex("saved_searches").insert({
        id: savedId, user_id: req.authUser!.id, name: body.name, query_json: JSON.stringify(body.query), visibility,
      });
      res.status(201).json({ id: savedId, user_id: req.authUser!.id, name: body.name, query_json: body.query, visibility });
    } catch (err) { next(err); }
  });

  r.get("/", async (req, res, next) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const rows = await knex("saved_searches")
        .where({ user_id: req.authUser!.id })
        .orWhere({ visibility: "public" })
        .select("id", "user_id", "name", "query_json", "visibility");
      const saved = rows.map((s) => {
        let query_json: SearchQuery | string = s.query_json;
        try { query_json = JSON.parse(s.query_json); } catch { /* keep raw string on parse error */ }
        return { ...s, query_json };
      });
      res.json({ saved });
    } catch (err) { next(err); }
  });

  r.post("/:id/run", async (req, res, next) => {
    try {
      const { knex, backend } = req.app.locals.deps as { knex: Knex; backend: SearchBackend };
      const params = parseOrFail(SavedSearchIdParamsSchema, req.params, res);
      if (!params) return;
      const row = await knex("saved_searches").where({ id: params.id }).first();
      const visible = row && (row.user_id === req.authUser!.id || row.visibility === "public");
      if (!visible) { res.status(404).json({ error: "not_found" }); return; }
      let query: SearchQuery;
      try { query = JSON.parse(row.query_json); } catch {
        res.status(500).json({ error: "corrupted_saved_search" }); return;
      }
      // IMPORTANT-3: validate the stored query before passing it to the backend.
      if (!isSearchQuery(query)) { res.status(500).json({ error: "corrupted_saved_search" }); return; }
      const results = await backend.search(query, viewerToScope(makeViewer(req)));
      res.json(results);
    } catch (err) { next(err); }
  });

  return r;
}

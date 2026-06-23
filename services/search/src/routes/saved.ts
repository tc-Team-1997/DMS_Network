import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import type { SaveSearchRequest, SearchQuery } from "../types.js";
import type { SearchBackend } from "../backend/SearchBackend.js";
import { scopeFromUser } from "./search.js";

export function savedRouter(): Router {
  const r = Router();
  r.use(requireAuth, requirePermission("document:read"));

  r.post("/", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const body = req.body as SaveSearchRequest;
    if (!body?.name || !body?.query) { res.status(400).json({ error: "invalid_saved_search" }); return; }
    const visibility = body.visibility === "public" ? "public" : "private";
    const [id] = await knex("saved_searches").insert({
      user_id: req.authUser!.id, name: body.name, query_json: JSON.stringify(body.query), visibility,
    }).returning("id");
    const savedId = typeof id === "object" ? (id as any).id : id;
    res.status(201).json({ id: savedId, user_id: req.authUser!.id, name: body.name, query_json: body.query, visibility });
  });

  r.get("/", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const rows = await knex("saved_searches")
      .where({ user_id: req.authUser!.id })
      .orWhere({ visibility: "public" })
      .select("id", "user_id", "name", "query_json", "visibility");
    res.json({ saved: rows.map((s) => ({ ...s, query_json: JSON.parse(s.query_json) })) });
  });

  r.post("/:id/run", async (req, res) => {
    const { knex, backend } = req.app.locals.deps as { knex: Knex; backend: SearchBackend };
    const row = await knex("saved_searches").where({ id: req.params.id }).first();
    const visible = row && (row.user_id === req.authUser!.id || row.visibility === "public");
    if (!visible) { res.status(404).json({ error: "not_found" }); return; }
    const query = JSON.parse(row.query_json) as SearchQuery;
    const results = await backend.search(query, scopeFromUser(req.authUser!));
    res.json(results);
  });

  return r;
}

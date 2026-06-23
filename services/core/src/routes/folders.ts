import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "../middleware.js";
import { createFolder, listTree, moveFolder } from "../repo/folders.js";

export function foldersRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/", requirePermission("folder:create"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    try {
      const folder = await createFolder(knex, {
        name: req.body.name,
        parentId: req.body.parentId ?? null,
        domain: req.body.domain,
        createdBy: req.authUser!.username,
      });
      res.status(201).json({ folder });
    } catch (e: any) {
      res.status(400).json({ error: String(e.message ?? e) });
    }
  });

  r.get("/", requirePermission("folder:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      res.json({ tree: await listTree(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.post("/:id/move", requirePermission("folder:create"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    try {
      const folder = await moveFolder(knex, Number(req.params.id), Number(req.body.parentId));
      res.json({ folder });
    } catch (e: any) {
      res.status(400).json({ error: String(e.message ?? e) });
    }
  });

  return r;
}

import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware.js";
import type { CoreDeps } from "../deps.js";
import { createAnnotation, listAnnotations, deleteAnnotation } from "../repo/annotations.js";

export function annotationsRouter(): Router {
  const r = Router({ mergeParams: true });
  r.use(requireAuth);

  r.get("/", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    res.json({ annotations: await listAnnotations(knex, Number(req.params.documentId)) });
  });

  r.post("/", requirePermission("annotation:write"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    try {
      const annotation = await createAnnotation(knex, Number(req.params.documentId), {
        kind: req.body.kind,
        page: Number(req.body.page ?? 1),
        x: Number(req.body.x),
        y: Number(req.body.y),
        width: Number(req.body.width),
        height: Number(req.body.height),
        content: req.body.content,
        color: req.body.color,
        createdBy: req.authUser!.username,
      });
      res.status(201).json({ annotation });
    } catch (e: any) { res.status(400).json({ error: String(e.message ?? e) }); }
  });

  r.delete("/:id", requirePermission("annotation:write"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    await deleteAnnotation(knex, Number(req.params.id));
    res.status(204).end();
  });

  return r;
}

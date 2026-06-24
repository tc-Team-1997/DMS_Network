import { Router } from "express";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { createAnnotation, listAnnotations, deleteAnnotation } from "../repo/annotations.js";
import { getDocument } from "../repo/documents.js";

export function annotationsRouter(): Router {
  const r = Router({ mergeParams: true });
  r.use(requireAuth);

  // GET / — list annotations; first verify caller can read the document (branch check)
  r.get("/", requirePermission("document:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      // C4: ensure the document belongs to the caller's branch before listing annotations
      const doc = await getDocument(knex, Number(req.params.documentId), makeViewer(req));
      if (!doc) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ annotations: await listAnnotations(knex, doc.id) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // POST / — create annotation; first verify caller can access the document
  r.post("/", requirePermission("annotation:write"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      // C4: branch-check the document before allowing annotation creation
      const doc = await getDocument(knex, Number(req.params.documentId), makeViewer(req));
      if (!doc) { res.status(404).json({ error: "not_found" }); return; }
      const annotation = await createAnnotation(knex, doc.id, {
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

  // DELETE /:id — delete annotation; verify it belongs to the document (C4 IDOR fix)
  r.delete("/:id", requirePermission("annotation:write"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      // C4: branch-check the parent document first
      const doc = await getDocument(knex, Number(req.params.documentId), makeViewer(req));
      if (!doc) { res.status(404).json({ error: "not_found" }); return; }
      // C4: pass documentId so only annotations owned by this document can be deleted
      const deleted = await deleteAnnotation(knex, Number(req.params.id), doc.id);
      if (!deleted) { res.status(404).json({ error: "not_found" }); return; }
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  return r;
}

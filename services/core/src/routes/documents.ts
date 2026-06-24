import { Router } from "express";
import multer from "multer";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { captureDocument, listDocuments, getDocument, softDeleteDocument, currentVersion } from "../repo/documents.js";
import { addVersion, listVersions, rollback } from "../repo/versions.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function documentsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // POST / — capture (document:capture)
  r.post("/", requirePermission("document:capture"), upload.single("file"), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      if (!req.file) { res.status(400).json({ error: "file_required" }); return; }
      // C2: only allow branch override if caller has crossbranch:read
      const viewer = makeViewer(req);
      const branch = (viewer.canCrossBranch && req.body.branch) ? req.body.branch : req.authUser!.branch;
      const document = await captureDocument(deps, {
        title: req.body.title ?? req.file.originalname,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        branch,
        ingestUserId: req.authUser!.username,
        sourceChannel: req.body.sourceChannel,
        folderId: req.body.folderId ? Number(req.body.folderId) : null,
      });
      res.status(201).json({ document });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // GET / — list (document:read)
  r.get("/", requirePermission("document:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const documents = await listDocuments(knex, makeViewer(req));
      res.json({ documents });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // GET /:id — fetch (document:read) — C1: branch-scoped
  r.get("/:id", requirePermission("document:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const document = await getDocument(knex, Number(req.params.id), makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ document });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // GET /:id/download — download (document:read) — C1 + C5: branch-scoped + safe filename
  r.get("/:id/download", requirePermission("document:read"), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const document = await getDocument(deps.knex, Number(req.params.id), makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      const v = await currentVersion(deps.knex, document.id);
      if (!v) { res.status(404).json({ error: "no_version" }); return; }
      const buf = await deps.storage.get(v.storage_key);
      res.setHeader("Content-Type", v.mime_type ?? "application/octet-stream");
      // C5: strip characters that can inject into Content-Disposition header
      const safeName = (document.original_filename ?? "document").replace(/["\r\n\\]/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      res.send(buf);
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // DELETE /:id — soft-delete (document:delete) — C1: branch-scoped
  r.delete("/:id", requirePermission("document:delete"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const document = await getDocument(knex, Number(req.params.id), makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      await softDeleteDocument(knex, document.id);
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // POST /:id/versions — add version (document:index) — C1: branch-scoped
  r.post("/:id/versions", requirePermission("document:index"), upload.single("file"), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const document = await getDocument(deps.knex, Number(req.params.id), makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      if (!req.file) { res.status(400).json({ error: "file_required" }); return; }
      const version = await addVersion(deps, document.id, {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        createdBy: req.authUser!.username,
        comment: req.body.comment,
      });
      res.status(201).json({ version });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // GET /:id/versions — list versions (document:read) — C1: branch-scoped
  r.get("/:id/versions", requirePermission("document:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      // verify caller can see this document
      const document = await getDocument(knex, Number(req.params.id), makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ versions: await listVersions(knex, document.id) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // POST /:id/rollback — rollback (document:index) — C1: branch-scoped
  r.post("/:id/rollback", requirePermission("document:index"), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const document = await getDocument(deps.knex, Number(req.params.id), makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      const version = await rollback(deps, document.id, Number(req.body.version));
      res.json({ version });
    } catch (e: any) { res.status(400).json({ error: String(e.message ?? e) }); }
  });

  return r;
}

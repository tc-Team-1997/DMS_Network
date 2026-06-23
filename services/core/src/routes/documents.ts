import { Router } from "express";
import multer from "multer";
import { requireAuth, requirePermission } from "../middleware.js";
import { can } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { captureDocument, listDocuments, getDocument, softDeleteDocument, currentVersion } from "../repo/documents.js";
import { addVersion, listVersions, rollback } from "../repo/versions.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function documentsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/", requirePermission("document:capture"), upload.single("file"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    if (!req.file) { res.status(400).json({ error: "file_required" }); return; }
    const document = await captureDocument(deps, {
      title: req.body.title ?? req.file.originalname,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      branch: req.body.branch ?? req.authUser!.branch,
      ingestUserId: req.authUser!.username,
      sourceChannel: req.body.sourceChannel,
      folderId: req.body.folderId ? Number(req.body.folderId) : null,
    });
    res.status(201).json({ document });
  });

  r.get("/", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    const canCrossBranch = can({ permissions: req.authUser!.permissions }, "crossbranch:read");
    const documents = await listDocuments(knex, { branch: req.authUser!.branch, canCrossBranch });
    res.json({ documents });
  });

  r.get("/:id", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    const document = await getDocument(knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ document });
  });

  r.get("/:id/download", requirePermission("document:read"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    const v = await currentVersion(deps.knex, document.id);
    if (!v) { res.status(404).json({ error: "no_version" }); return; }
    const buf = await deps.storage.get(v.storage_key);
    res.setHeader("Content-Type", v.mime_type ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${document.original_filename ?? "document"}"`);
    res.send(buf);
  });

  r.delete("/:id", requirePermission("document:delete"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    const document = await getDocument(knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    await softDeleteDocument(knex, document.id);
    res.status(204).end();
  });

  // Version routes
  r.post("/:id/versions", requirePermission("document:index"), upload.single("file"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    if (!req.file) { res.status(400).json({ error: "file_required" }); return; }
    const version = await addVersion(deps, document.id, {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      createdBy: req.authUser!.username,
      comment: req.body.comment,
    });
    res.status(201).json({ version });
  });

  r.get("/:id/versions", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    res.json({ versions: await listVersions(knex, Number(req.params.id)) });
  });

  r.post("/:id/rollback", requirePermission("document:index"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    try {
      const version = await rollback(deps, document.id, Number(req.body.version));
      res.json({ version });
    } catch (e: any) { res.status(400).json({ error: String(e.message ?? e) }); }
  });

  return r;
}

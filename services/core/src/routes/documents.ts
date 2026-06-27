import { Router } from "express";
import multer from "multer";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { captureDocument, listDocuments, getDocument, softDeleteDocument, currentVersion } from "../repo/documents.js";
import { holdsFor } from "../modules/records.js";
import { addVersion, listVersions, rollback } from "../repo/versions.js";
import { catalog, categoryFor } from "../catalog/engine.js";
import { computeQuality } from "../catalog/quality.js";
import { burnStamp, burnRedaction, type RedactRegion } from "../repo/burnin.js";
import { buildSummary } from "../ai/summarize.js";
import { EVENTS } from "../events/index.js";
import { enqueue } from "../queue/index.js";
import { extractIdempotencyKey } from "../worker/handlers.js";
import { validateBody } from "../openapi/validate.js";
import { RollbackSchema, StampSchema, RedactSchema, PatchDocumentSchema } from "../openapi/schemas.js";

function bearerFrom(authHeader: string | undefined): string {
  if (!authHeader) return "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
}

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
        folderId: req.body.folderId ? String(req.body.folderId) : null,
      });
      res.status(201).json({ document });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // POST /bulk — BULK ingestion (document:capture).
  // Captures many files in one request, then enqueues a durable async "extract"
  // job per document (idempotent by docId → never double-extracts) so heavy
  // bulk loads never run extraction on the request path. Returns 202.
  r.post("/bulk", requirePermission("document:capture"), upload.array("files", 200), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) { res.status(400).json({ error: "files_required" }); return; }

      const viewer = makeViewer(req);
      const branch = (viewer.canCrossBranch && req.body.branch) ? req.body.branch : req.authUser!.branch;
      const bearer = bearerFrom(req.headers.authorization);
      const username = req.authUser!.username;

      const items: Array<{ docId: string; jobId: string }> = [];
      for (const file of files) {
        const document = await captureDocument(deps, {
          title: file.originalname,
          filename: file.originalname,
          mimeType: file.mimetype,
          buffer: file.buffer,
          branch,
          ingestUserId: username,
          sourceChannel: req.body.sourceChannel ?? "BULK",
          folderId: req.body.folderId ? String(req.body.folderId) : null,
        });
        await deps.knex("documents").where({ id: document.id }).update({ extraction_status: "QUEUED" });
        const job = await enqueue(
          deps.knex,
          "extract",
          { docId: document.id, bearer, callerUsername: username },
          { idempotencyKey: extractIdempotencyKey(document.id) },
        );
        items.push({ docId: document.id, jobId: job.id });
      }

      res.status(202).json({ count: items.length, items, status: "queued" });
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
      const document = await getDocument(knex, req.params.id, makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ document });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // POST /:id/summarize — generate + persist a plain-language AI summary from
  // the document's classification + extracted metadata (document:read).
  r.post("/:id/summarize", requirePermission("document:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const document = await getDocument(knex, req.params.id, makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      let metadata: Record<string, unknown> = {};
      try { metadata = document.metadata ? JSON.parse(document.metadata as string) : {}; } catch { /* ignore */ }
      const summary = buildSummary({
        docType: document.doc_type as string | null,
        category: document.catalog_category as string | null,
        branch: document.branch as string | null,
        confidence: document.confidence as number | null,
        metadata,
      });
      await knex("documents").where({ id: document.id }).update({ summary });
      res.json({ summary });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // GET /:id/download — serve the raw file (document:read) — C1 + C5: branch-scoped
  // + safe filename. `?inline=1` serves Content-Disposition: inline so browsers
  // (and the web viewer's blob fetch) can preview PDFs/images in place.
  r.get("/:id/download", requirePermission("document:read"), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const document = await getDocument(deps.knex, req.params.id, makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      const v = await currentVersion(deps.knex, document.id);
      if (!v) { res.status(404).json({ error: "no_version" }); return; }
      let buf: Buffer;
      try {
        buf = await deps.storage.get(v.storage_key);
      } catch {
        // Stored file missing on disk (e.g. metadata-only seed doc) → 404, not 500.
        res.status(404).json({ error: "file_unavailable" });
        return;
      }
      res.setHeader("Content-Type", v.mime_type ?? "application/octet-stream");
      // C5: strip characters that can inject into Content-Disposition header
      const safeName = (document.original_filename ?? "document").replace(/["\r\n\\]/g, "_");
      const disposition = req.query.inline === "1" ? "inline" : "attachment";
      res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);
      res.send(buf);
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // DELETE /:id — soft-delete (document:delete) — C1: branch-scoped
  r.delete("/:id", requirePermission("document:delete"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const document = await getDocument(knex, req.params.id, makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      // P9: a document under an active legal hold MUST NOT be deletable.
      const hold = await holdsFor(knex, document.id);
      if (hold) { res.status(409).json({ error: "under_legal_hold", hold }); return; }
      await softDeleteDocument(knex, document.id);
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // POST /:id/versions — add version (document:index) — C1: branch-scoped
  r.post("/:id/versions", requirePermission("document:index"), upload.single("file"), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const document = await getDocument(deps.knex, req.params.id, makeViewer(req));
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
      const document = await getDocument(knex, req.params.id, makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ versions: await listVersions(knex, document.id) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  // POST /:id/rollback — rollback (document:index) — C1: branch-scoped
  r.post("/:id/rollback", requirePermission("document:index"), validateBody(RollbackSchema), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const document = await getDocument(deps.knex, req.params.id, makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      const version = await rollback(deps, document.id, Number(req.body.version));
      res.json({ version });
    } catch (e: any) { res.status(400).json({ error: String(e.message ?? e) }); }
  });

  // POST /:id/stamp — burn a visible APPROVED stamp into a NEW version (document:approve)
  // Body: { label?: "APPROVED", by: string, date?: string, page?: number, ref?: string }
  // Returns: { version, download } where download is the path to fetch the new bytes.
  r.post("/:id/stamp", requirePermission("document:approve"), validateBody(StampSchema), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const document = await getDocument(deps.knex, req.params.id, makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      const v = await currentVersion(deps.knex, document.id);
      if (!v) { res.status(404).json({ error: "no_version" }); return; }

      const by = String(req.body?.by ?? req.authUser!.username);
      if (!by) { res.status(400).json({ error: "by_required" }); return; }
      const label = String(req.body?.label ?? "APPROVED");
      const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
      const page = req.body?.page != null ? Number(req.body.page) : undefined;
      const ref = req.body?.ref != null ? String(req.body.ref) : undefined;

      const original = await deps.storage.get(v.storage_key);
      const stamped = await burnStamp(original, v.mime_type, { label, by, date, page, ref });

      const version = await addVersion(deps, document.id, {
        buffer: stamped,
        mimeType: v.mime_type,
        createdBy: req.authUser!.username,
        comment: `stamp:${label} by ${by} on ${date}${ref ? ` ref ${ref}` : ""}`,
      });
      await deps.events.emit(EVENTS.DOCUMENT_STAMPED, {
        docId: document.id, version: version.version_no, by, label, hash: version.file_hash_sha256,
      });
      res.status(201).json({ version, download: `/documents/${document.id}/download` });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // POST /:id/redact — DESTRUCTIVELY redact regions into a NEW version (document:write)
  // Body: { regions: [{ page:number, x:number, y:number, w:number, h:number }] }
  //   coords normalized 0..1 of page/image size, TOP-LEFT origin.
  // Returns: { version, download, redaction: { rasterized, guarantee } }
  r.post("/:id/redact", requirePermission("document:write"), validateBody(RedactSchema), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const document = await getDocument(deps.knex, req.params.id, makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }
      const v = await currentVersion(deps.knex, document.id);
      if (!v) { res.status(404).json({ error: "no_version" }); return; }

      const raw = req.body?.regions;
      if (!Array.isArray(raw) || raw.length === 0) { res.status(400).json({ error: "regions_required" }); return; }
      const regions: RedactRegion[] = raw.map((r: any) => ({
        page: Number(r.page ?? 1),
        x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h),
      }));
      if (regions.some((r) => [r.x, r.y, r.w, r.h].some((n) => !Number.isFinite(n)))) {
        res.status(400).json({ error: "invalid_region" }); return;
      }

      const original = await deps.storage.get(v.storage_key);
      const { bytes, rasterized } = await burnRedaction(original, v.mime_type, regions);

      const version = await addVersion(deps, document.id, {
        buffer: bytes,
        mimeType: v.mime_type,
        createdBy: req.authUser!.username,
        comment: `redact:${regions.length} region(s) ${rasterized ? "(rasterized,destructive)" : "(overlay)"}`,
      });
      await deps.events.emit(EVENTS.DOCUMENT_REDACTED, {
        docId: document.id, version: version.version_no, regions: regions.length, rasterized,
        hash: version.file_hash_sha256,
      });
      res.status(201).json({
        version,
        download: `/documents/${document.id}/download`,
        redaction: {
          rasterized,
          guarantee: rasterized
            ? "destructive: underlying content removed (raster re-embed / pixel overwrite)"
            : "overlay-only: opaque rectangles drawn (poppler unavailable)",
        },
      });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // PATCH /:id — metadata correction (document:index) — C1: branch-scoped
  // Body: { doc_type?, catalog_category?, cid?, doc_no?, folder_id?, metadata? }
  r.patch("/:id", requirePermission("document:index"), validateBody(PatchDocumentSchema), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const document = await getDocument(deps.knex, req.params.id, makeViewer(req));
      if (!document) { res.status(404).json({ error: "not_found" }); return; }

      const body = req.body as {
        doc_type?: string;
        catalog_category?: string;
        cid?: string;
        doc_no?: string;
        folder_id?: string | null;
        metadata?: Record<string, unknown>;
      };

      // Merge metadata
      let existingMeta: Record<string, unknown> = {};
      try {
        if (document.metadata) existingMeta = JSON.parse(document.metadata);
      } catch { /* ignore */ }

      const mergedMeta = body.metadata
        ? { ...existingMeta, ...body.metadata }
        : existingMeta;

      const newDocType = body.doc_type ?? document.doc_type ?? "UNKNOWN";

      // Recompute catalog
      const fields = { ...mergedMeta, ...(body.cid ? { cid_no: body.cid } : document.cid ? { cid_no: document.cid } : {}) };
      const catalogResult = catalog({
        docType: newDocType,
        confidence: document.confidence ?? 0,
        fields,
      });

      // Recompute quality — use the doc-type-derived category (not _Review/Pending override)
      const qualityCategory = body.catalog_category ?? categoryFor(newDocType);
      const quality = computeQuality(
        qualityCategory,
        fields,
        document.confidence ?? 0,
      );

      const updates: Record<string, unknown> = {
        metadata: JSON.stringify(mergedMeta),
        doc_type: newDocType,
        review_flag: quality.mandatoryMissing.length > 0 || (document.confidence ?? 0) < 0.85,
      };
      if (body.catalog_category) updates["catalog_category"] = body.catalog_category;
      else if (catalogResult.route !== "HUMAN_REVIEW") updates["catalog_category"] = catalogResult.category;
      if (body.cid !== undefined) updates["cid"] = body.cid;
      if (body.doc_no !== undefined) updates["doc_no"] = body.doc_no;
      if (body.folder_id !== undefined) updates["folder_id"] = body.folder_id;

      await deps.knex("documents").where({ id: document.id }).update(updates);
      const updated = await deps.knex("documents").where({ id: document.id }).first();

      res.json({
        document: { ...updated, review_flag: Boolean(updated.review_flag) },
        quality: {
          score: quality.score,
          completeness: quality.completeness,
          mandatoryMissing: quality.mandatoryMissing,
          confidence: quality.confidence,
        },
        catalog: {
          category: catalogResult.category,
          route: catalogResult.route,
          mandatoryOk: catalogResult.mandatoryOk,
          missing: catalogResult.missing,
        },
      });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  return r;
}

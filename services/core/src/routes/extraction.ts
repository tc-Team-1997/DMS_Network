/**
 * POST /documents/:id/extract  (RBAC: document:index)
 *
 * Enterprise AI Extraction + Auto-Classify pipeline.
 *
 * Steps:
 *   1. Load document + current version bytes from storage.
 *   2. Call AI service:  /idp/classify  then  /idp/extract  (or /idp/process).
 *   3. Map extracted fields → document columns (cid, doc_no, metadata).
 *   4. Auto-catalog via catalog/engine.ts.
 *   5. Auto-map via mapper/directory.ts (folder assignment).
 *   6. Set doc_type, confidence, review_flag, extraction_status.
 *   7. Return enriched document + classification + mappedFields + catalog + suggestedNewType.
 *
 * Degrades gracefully if AI service is unreachable (ocr-fallback source).
 */

import { Router } from "express";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { getDocument, currentVersion } from "../repo/documents.js";
import { catalog } from "../catalog/engine.js";
import { resolvePath, defaultAcls, domainForPath } from "../mapper/directory.js";
import { setFolderAcls, effectiveAcls } from "../repo/acls.js";
import { aiClassify, aiExtract } from "../ai/client.js";
import { mapExtractedToDocument } from "../ai/field_mapper.js";
import { buildNewTypeSuggestion } from "../ai/suggest_type.js";
import { EVENTS } from "../events/index.js";
import type { Knex } from "knex";

// ── Helpers ────────────────────────────────────────────────────────────────────

function idOf(inserted: unknown): number {
  const x = (inserted as unknown[])[0];
  return typeof x === "object" && x !== null ? (x as { id: number }).id : (x as number);
}

async function ensureFolderChain(knex: Knex, path: string, createdBy: string): Promise<number> {
  const clean = path.replace(/\/+$/, "");
  const segments = clean.split("/").filter(Boolean).slice(1); // drop "BoB"
  let parentId: number | null = null;
  let currentPath = "/BoB";
  let leafId = 0;
  for (const seg of segments) {
    currentPath = `${currentPath}/${seg}`;
    let folder = await knex("folders").where({ path: currentPath }).first();
    if (!folder) {
      const inserted = await knex("folders").insert({
        name: seg,
        parent_id: parentId,
        path: currentPath,
        domain: domainForPath(currentPath),
        created_by: createdBy,
      }).returning("id");
      folder = { id: idOf(inserted) };
    }
    parentId = folder.id;
    leafId = folder.id;
  }
  return leafId;
}

function addYears(iso: string, years: number): string {
  if (years >= 9999) return "9999-12-31";
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader) return "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
}

// ── Router ─────────────────────────────────────────────────────────────────────

export function extractionRouter(): Router {
  const r = Router({ mergeParams: true });
  r.use(requireAuth);

  /**
   * POST /documents/:id/extract
   *
   * Returns 200 on success, 404 if document not found, 500 on internal error.
   */
  r.post("/:id/extract", requirePermission("document:index"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const docId = Number(req.params.id);
    const viewer = makeViewer(req);
    const bearer = extractBearerToken(req.headers.authorization);
    const callerUsername = req.authUser!.username;

    // ── 1. Load document ─────────────────────────────────────────────────────
    const document = await getDocument(deps.knex, docId, viewer);
    if (!document) { res.status(404).json({ error: "not_found" }); return; }

    const version = await currentVersion(deps.knex, docId);
    if (!version) { res.status(404).json({ error: "no_version" }); return; }

    // Mark as RUNNING
    await deps.knex("documents").where({ id: docId }).update({ extraction_status: "RUNNING" });

    try {
      // ── 2. Fetch file bytes from storage ───────────────────────────────────
      let fileBuffer: Buffer;
      try {
        fileBuffer = await deps.storage.get(version.storage_key);
      } catch {
        fileBuffer = Buffer.alloc(0);
      }

      const mimeType = version.mime_type ?? document.mime_type ?? "application/octet-stream";
      const fileName = document.original_filename ?? "document";

      // ── 3. Call AI service ─────────────────────────────────────────────────
      let classifyResult: { doc_type: string; confidence: number } = { doc_type: "UNKNOWN", confidence: 0 };
      let extractResult: { data: Record<string, unknown> | null; errors: string[]; partial: boolean } = { data: null, errors: [], partial: false };
      let aiSource: "ai" | "ocr-fallback" = "ai";

      try {
        // Step A: classify
        const cls = await aiClassify(bearer, fileBuffer, fileName, mimeType);
        classifyResult = { doc_type: cls.doc_type, confidence: cls.confidence };

        // Step B: extract (only if confidence high enough to bother)
        if (cls.confidence >= 0.3 && cls.doc_type !== "UNKNOWN") {
          const ext = await aiExtract(bearer, fileBuffer, fileName, mimeType, cls.doc_type);
          extractResult = { data: ext.data, errors: ext.errors, partial: ext.partial };
        }
      } catch (aiErr: any) {
        // AI service unreachable — degrade gracefully
        aiSource = "ocr-fallback";
        classifyResult = { doc_type: document.doc_type ?? "UNKNOWN", confidence: document.confidence ?? 0 };
        extractResult = { data: document.metadata ? JSON.parse(document.metadata) : null, errors: [`AI unavailable: ${String(aiErr?.message ?? aiErr)}`], partial: true };
      }

      // ── 4. Map extracted fields ────────────────────────────────────────────
      const mapped = mapExtractedToDocument(classifyResult.doc_type, extractResult.data);

      // ── 5. Load known doc types for new-type suggestion ────────────────────
      const registryCodes = new Set<string>(
        (await deps.knex("doc_type_registry").select("code")).map((r: any) => r.code as string),
      );

      // ── 6. Auto-catalog ────────────────────────────────────────────────────
      const fields = { ...mapped.metadata, ...(mapped.cid ? { cid_no: mapped.cid } : {}) };
      const catalogResult = catalog({
        docType: classifyResult.doc_type,
        confidence: classifyResult.confidence,
        fields,
      });

      // ── 7. Auto-map folder ─────────────────────────────────────────────────
      const folderPath = resolvePath(classifyResult.doc_type, fields);
      let folderId: number | null = null;
      let mapPath: string | null = folderPath;
      let mapAcls: unknown[] = [];
      try {
        folderId = await ensureFolderChain(deps.knex, folderPath, callerUsername);
        const domain = domainForPath(folderPath);
        await setFolderAcls(deps.knex, folderId, defaultAcls(domain), false);
        mapAcls = await effectiveAcls(deps.knex, folderId);
      } catch {
        folderId = null;
        mapPath = null;
      }

      // ── 8. Persist all updates ─────────────────────────────────────────────
      const reviewFlag = classifyResult.confidence < 0.85 || catalogResult.reviewFlag === true;
      const ingest = (document.ingest_timestamp as string | undefined) ?? new Date().toISOString();

      const updates: Record<string, unknown> = {
        doc_type: classifyResult.doc_type,
        confidence: classifyResult.confidence,
        review_flag: reviewFlag,
        extraction_status: "DONE",
        extracted_at: new Date().toISOString(),
        metadata: JSON.stringify(mapped.metadata),
      };
      if (mapped.cid) updates["cid"] = mapped.cid;
      if (mapped.doc_no) updates["doc_no"] = mapped.doc_no;
      if (folderId) updates["folder_id"] = folderId;

      if (catalogResult.route !== "HUMAN_REVIEW") {
        updates["catalog_category"] = catalogResult.category;
        updates["retention_years"] = catalogResult.retentionYears;
        updates["destruction_date"] = addYears(ingest, catalogResult.retentionYears);
      }

      await deps.knex("documents").where({ id: docId }).update(updates);

      // ── 9. Emit event ──────────────────────────────────────────────────────
      await deps.events.emit(EVENTS.DOCUMENT_INDEXED, {
        docId,
        docType: classifyResult.doc_type,
        confidence: classifyResult.confidence,
        source: aiSource,
      });

      // ── 10. Build response ─────────────────────────────────────────────────
      const updatedDoc = await deps.knex("documents").where({ id: docId }).first();
      const finalDoc = { ...updatedDoc, review_flag: Boolean(updatedDoc.review_flag) };

      const suggestedNewType = buildNewTypeSuggestion(
        classifyResult.doc_type,
        classifyResult.confidence,
        registryCodes,
        extractResult.data,
      );

      res.json({
        document: finalDoc,
        classification: {
          doc_type: classifyResult.doc_type,
          confidence: classifyResult.confidence,
          review_flag: reviewFlag,
        },
        mappedFields: {
          cid: mapped.cid ?? null,
          doc_no: mapped.doc_no ?? null,
          mappedKeys: mapped.mappedKeys,
          data: mapped.metadata,
          partial: extractResult.partial,
          errors: extractResult.errors,
        },
        catalog: {
          category: catalogResult.category,
          route: catalogResult.route,
          mandatoryOk: catalogResult.mandatoryOk,
          missing: catalogResult.missing,
          retentionYears: catalogResult.retentionYears,
          alertRule: catalogResult.alertRule ?? null,
        },
        folder: folderId ? { folderId, path: mapPath, acls: mapAcls } : null,
        suggestedNewType: suggestedNewType ?? null,
        source: aiSource,
      });
    } catch (err: any) {
      // Unexpected error — mark FAILED and re-throw
      await deps.knex("documents").where({ id: docId }).update({ extraction_status: "FAILED" }).catch(() => {});
      res.status(500).json({ error: "internal", detail: String(err?.message ?? err) });
    }
  });

  return r;
}

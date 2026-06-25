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
 *   7. Duplicate detection (honoring dedup config).
 *   8. Auto-versioning if dedup action=auto_version and hash duplicate found.
 *   9. Quality/completeness scoring.
 *  10. Return enriched document + classification + mappedFields + catalog + suggestedNewType + quality + duplicates.
 *
 * Degrades gracefully if AI service is unreachable (ocr-fallback source).
 */

import { Router } from "express";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { getDocument, currentVersion } from "../repo/documents.js";
import { catalog, categoryFor } from "../catalog/engine.js";
import { computeQuality } from "../catalog/quality.js";
import { resolvePath, defaultAcls, domainForPath } from "../mapper/directory.js";
import { setFolderAcls, effectiveAcls } from "../repo/acls.js";
import { aiClassify, aiExtract } from "../ai/client.js";
import { mapExtractedToDocument } from "../ai/field_mapper.js";
import { buildNewTypeSuggestion } from "../ai/suggest_type.js";
import { EVENTS } from "../events/index.js";
import { findDuplicates, getDedupConfig } from "../repo/duplicates.js";
import { newId } from "@zordms/db";
import type { Knex } from "knex";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function ensureFolderChain(knex: Knex, path: string, createdBy: string): Promise<string> {
  const clean = path.replace(/\/+$/, "");
  const segments = clean.split("/").filter(Boolean).slice(1); // drop "BoB"
  let parentId: string | null = null;
  let currentPath = "/BoB";
  let leafId = "";
  for (const seg of segments) {
    currentPath = `${currentPath}/${seg}`;
    let folder = await knex("folders").where({ path: currentPath }).first();
    if (!folder) {
      const id = newId();
      await knex("folders").insert({
        id,
        name: seg,
        parent_id: parentId,
        path: currentPath,
        domain: domainForPath(currentPath),
        created_by: createdBy,
      });
      folder = { id };
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

/** Append a new document_version to an existing document (auto-versioning). Safe + idempotent.
 *  Idempotency: uses dupeDocId as the "source" marker in the comment.
 *  If a version with that marker already exists, skip.
 */
async function appendVersionToExisting(
  knex: Knex,
  originalDocId: string,
  dupeDoc: { id: string; file_hash_sha256: string; current_version: number; file_size_bytes: number },
  storageKey: string,
  createdBy: string,
): Promise<void> {
  const marker = `auto-versioned from doc#${dupeDoc.id}`;
  await knex.transaction(async (tx) => {
    // Idempotency: if this dupe doc was already absorbed, skip
    const alreadyVersioned = await tx("document_versions")
      .where({ document_id: originalDocId })
      .andWhereRaw("comment = ?", [marker])
      .first();
    if (alreadyVersioned) return;

    const maxRow = await tx("document_versions").where({ document_id: originalDocId }).max("version_no as m");
    const nextVer = Number(maxRow[0]?.m ?? 0) + 1;

    await tx("document_versions").insert({
      id: newId(),
      document_id: originalDocId,
      version_no: nextVer,
      storage_key: storageKey,
      file_hash_sha256: dupeDoc.file_hash_sha256,
      file_size_bytes: dupeDoc.file_size_bytes,
      created_by: createdBy,
      comment: marker,
    });
    await tx("documents").where({ id: originalDocId }).update({
      current_version: nextVer,
      file_hash_sha256: dupeDoc.file_hash_sha256,
      file_size_bytes: dupeDoc.file_size_bytes,
    });
  });
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
    const docId = req.params.id;
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
      let folderId: string | null = null;
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
        metadata: JSON.stringify({ ...(extractResult.data ?? {}), ...mapped.metadata }),
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

      // ── 9. Duplicate detection (honors dedup config) ───────────────────────
      const dedupCfg = await getDedupConfig(deps.knex);
      let duplicates: Awaited<ReturnType<typeof findDuplicates>> = [];
      let autoVersioned = false;

      if (dedupCfg.enabled) {
        duplicates = await findDuplicates(deps.knex, {
          docId,
          fileHashSha256: document.file_hash_sha256,
          cid: mapped.cid ?? document.cid,
          docNo: mapped.doc_no ?? document.doc_no,
          docType: classifyResult.doc_type,
          matchBy: dedupCfg.matchBy,
        });

        // Auto-versioning: if hash duplicate found and action=auto_version
        if (
          dedupCfg.action === "auto_version" &&
          duplicates.length > 0
        ) {
          const hashDupe = duplicates.find((d) => d.matchType === "hash");
          if (hashDupe) {
            // Append the current document's version to the original document
            await appendVersionToExisting(
              deps.knex,
              hashDupe.id,
              {
                id: docId,
                file_hash_sha256: document.file_hash_sha256,
                current_version: document.current_version,
                file_size_bytes: document.file_size_bytes ?? 0,
              },
              version.storage_key,
              callerUsername,
            );
            // Soft-handle the duplicate document (mark as superseded)
            await deps.knex("documents").where({ id: docId }).update({
              status: "Superseded",
              extraction_status: "DONE",
            });
            autoVersioned = true;
          }
        }
      }

      // ── 10. Quality scoring ────────────────────────────────────────────────
      // Use the doc-type-derived category for quality (not the _Review/Pending override)
      const qualityCategory = categoryFor(classifyResult.doc_type);
      const quality = computeQuality(
        qualityCategory,
        fields,
        classifyResult.confidence,
      );

      // If quality is low or mandatory missing, ensure review_flag is set
      if (quality.mandatoryMissing.length > 0 || quality.score < 50) {
        await deps.knex("documents").where({ id: docId }).update({ review_flag: true });
      }

      // ── 11. Emit event ─────────────────────────────────────────────────────
      await deps.events.emit(EVENTS.DOCUMENT_INDEXED, {
        docId,
        docType: classifyResult.doc_type,
        confidence: classifyResult.confidence,
        source: aiSource,
      });

      // ── 12. Build response ─────────────────────────────────────────────────
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
        quality: {
          score: quality.score,
          completeness: quality.completeness,
          mandatoryMissing: quality.mandatoryMissing,
          confidence: quality.confidence,
        },
        duplicates: duplicates.map((d) => ({
          id: d.id,
          title: d.title,
          doc_type: d.doc_type,
          branch: d.branch,
          ingest_timestamp: d.ingest_timestamp,
          matchType: d.matchType,
        })),
        autoVersioned,
        rawMetadata: extractResult.data ?? {},
      });
    } catch (err: any) {
      // Unexpected error — mark FAILED and re-throw
      await deps.knex("documents").where({ id: docId }).update({ extraction_status: "FAILED" }).catch(() => {});
      res.status(500).json({ error: "internal", detail: String(err?.message ?? err) });
    }
  });

  return r;
}

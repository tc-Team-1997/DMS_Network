/**
 * P8: Reusable document EXTRACTION pipeline.
 *
 * The full classify→extract→map→catalog→folder→dedup→quality→workflow→event
 * pipeline, factored OUT of the inline POST /documents/:id/extract handler so it
 * can be called from BOTH:
 *   - the synchronous route (interactive single capture), and
 *   - the durable "extract" job handler (async / bulk, off the request path).
 *
 * Behaviour is identical to the original inline implementation; the route is now
 * a thin wrapper that loads the doc, runs this, and shapes the HTTP response.
 */
import type { Knex } from "knex";
import type { CoreDeps } from "../deps.js";
import { getDocument, currentVersion } from "../repo/documents.js";
import { catalog, categoryFor } from "../catalog/engine.js";
import { computeQuality } from "../catalog/quality.js";
import { resolvePath, applyFolderTemplate, defaultAcls, domainForPath } from "../mapper/directory.js";
import { getSettings } from "../repo/systemSettings.js";
import { setFolderAcls, effectiveAcls } from "../repo/acls.js";
import { aiClassify, aiExtract } from "../ai/client.js";
import { mapExtractedToDocument } from "../ai/field_mapper.js";
import { buildNewTypeSuggestion } from "../ai/suggest_type.js";
import { buildSummary } from "../ai/summarize.js";
import { EVENTS } from "../events/index.js";
import { createWorkflowCase } from "../workflow/client.js";
import { findDuplicates, getDedupConfig } from "../repo/duplicates.js";
import { newId } from "@zordms/db";

// ── Helpers (moved verbatim from the inline route) ─────────────────────────────

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

async function appendVersionToExisting(
  knex: Knex,
  originalDocId: string,
  dupeDoc: { id: string; file_hash_sha256: string; current_version: number; file_size_bytes: number },
  storageKey: string,
  createdBy: string,
): Promise<void> {
  const marker = `auto-versioned from doc#${dupeDoc.id}`;
  await knex.transaction(async (tx) => {
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

// ── Public types ───────────────────────────────────────────────────────────────

export interface RunExtractionContext {
  /** Bearer token forwarded to the AI service + workflow service. May be "". */
  bearer: string;
  /** Username recorded as folder creator / version author. */
  callerUsername: string;
  /** Viewer for branch-scoped document access (defaults to cross-branch for jobs). */
  viewer?: { branch?: string; canCrossBranch: boolean };
}

export type ExtractionOutcome =
  | { ok: false; status: 404; reason: "not_found" | "no_version" }
  | { ok: true; result: ExtractionResult };

export interface ExtractionResult {
  document: Record<string, unknown>;
  classification: { doc_type: string; confidence: number; review_flag: boolean };
  workflow_id: string | null;
  mappedFields: {
    cid: string | null;
    doc_no: string | null;
    mappedKeys: string[];
    data: Record<string, unknown>;
    partial: boolean;
    errors: string[];
  };
  catalog: {
    category: string;
    route: string;
    mandatoryOk: boolean;
    missing: string[];
    retentionYears: number;
    alertRule: unknown;
  };
  folder: { folderId: string; path: string | null; acls: unknown[] } | null;
  suggestedNewType: unknown;
  source: "ai" | "ocr-fallback";
  quality: { score: number; completeness: number; mandatoryMissing: string[]; confidence: number };
  duplicates: Array<Record<string, unknown>>;
  autoVersioned: boolean;
  rawMetadata: Record<string, unknown>;
}

/**
 * Run the full extraction pipeline for one document. Throws on unexpected
 * errors (caller decides HTTP 500 / job retry); sets extraction_status=FAILED
 * on throw, =DONE on success, =RUNNING at start.
 */
export async function runExtraction(
  deps: CoreDeps,
  docId: string,
  ctx: RunExtractionContext,
): Promise<ExtractionOutcome> {
  const viewer = ctx.viewer ?? { canCrossBranch: true };
  const bearer = ctx.bearer;
  const callerUsername = ctx.callerUsername;

  // ── 1. Load document ─────────────────────────────────────────────────────
  const document = await getDocument(deps.knex, docId, viewer);
  if (!document) return { ok: false, status: 404, reason: "not_found" };

  const version = await currentVersion(deps.knex, docId);
  if (!version) return { ok: false, status: 404, reason: "no_version" };

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
      const cls = await aiClassify(bearer, fileBuffer, fileName, mimeType);
      classifyResult = { doc_type: cls.doc_type, confidence: cls.confidence };

      if (cls.confidence >= 0.3 && cls.doc_type !== "UNKNOWN") {
        const ext = await aiExtract(bearer, fileBuffer, fileName, mimeType, cls.doc_type);
        extractResult = { data: ext.data, errors: ext.errors, partial: ext.partial };
      }
    } catch (aiErr: any) {
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
    // Prefer the doc-type's admin-defined folder template; else the built-in
    // rules. Skipped entirely when auto-routing is disabled in platform settings.
    const settings = await getSettings(deps.knex).catch(() => null);
    const autoRoute = settings?.autoFolderRouting ?? true;
    const typeRow = await deps.knex("doc_type_registry").where({ code: classifyResult.doc_type }).first().catch(() => null);
    const templatePath = applyFolderTemplate(typeRow?.folder_path_template, fields);
    const folderPath = templatePath ?? resolvePath(classifyResult.doc_type, fields);
    let folderId: string | null = null;
    let mapPath: string | null = autoRoute ? folderPath : null;
    let mapAcls: unknown[] = [];
    if (autoRoute) {
      try {
        folderId = await ensureFolderChain(deps.knex, folderPath, callerUsername);
        const domain = domainForPath(folderPath);
        await setFolderAcls(deps.knex, folderId, defaultAcls(domain), false);
        mapAcls = await effectiveAcls(deps.knex, folderId);
      } catch {
        folderId = null;
        mapPath = null;
      }
    }

    // ── 8. Persist all updates ─────────────────────────────────────────────
    const reviewFlag = classifyResult.confidence < 0.85 || catalogResult.reviewFlag === true;
    const ingest = (document.ingest_timestamp as string | undefined) ?? new Date().toISOString();

    const mergedMeta = { ...(extractResult.data ?? {}), ...mapped.metadata };
    const updates: Record<string, unknown> = {
      doc_type: classifyResult.doc_type,
      confidence: classifyResult.confidence,
      review_flag: reviewFlag,
      extraction_status: "DONE",
      extracted_at: new Date().toISOString(),
      metadata: JSON.stringify(mergedMeta),
      // Plain-language summary surfaced in indexing / discovery.
      summary: buildSummary({
        docType: classifyResult.doc_type,
        category: catalogResult.route !== "HUMAN_REVIEW" ? catalogResult.category : null,
        branch: (document.branch as string | undefined) ?? null,
        confidence: classifyResult.confidence,
        metadata: mergedMeta,
      }),
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

      if (dedupCfg.action === "auto_version" && duplicates.length > 0) {
        const hashDupe = duplicates.find((d) => d.matchType === "hash");
        if (hashDupe) {
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
          await deps.knex("documents").where({ id: docId }).update({
            status: "Superseded",
            extraction_status: "DONE",
          });
          autoVersioned = true;
        }
      }
    }

    // ── 10. Quality scoring ────────────────────────────────────────────────
    const qualityCategory = categoryFor(classifyResult.doc_type);
    const quality = computeQuality(qualityCategory, fields, classifyResult.confidence);

    const qualityForcedReview = quality.mandatoryMissing.length > 0 || quality.score < 50;
    if (qualityForcedReview) {
      await deps.knex("documents").where({ id: docId }).update({ review_flag: true });
    }

    const unknownType =
      classifyResult.doc_type === "UNKNOWN" || !registryCodes.has(classifyResult.doc_type);
    const finalReviewFlag = reviewFlag || qualityForcedReview || unknownType;

    // ── 11. Capture→Workflow handoff (best-effort) ─────────────────────────
    let workflowId: string | null = null;
    if (finalReviewFlag) {
      try {
        const wf = await createWorkflowCase(bearer, {
          docId,
          title: document.title ?? fileName ?? `Review ${docId}`,
          branch: document.branch ?? undefined,
          confidence: classifyResult.confidence,
          priority: unknownType || quality.score < 50 ? "High" : "Normal",
        });
        workflowId = wf.id;
        await deps.knex("documents").where({ id: docId }).update({ workflow_id: workflowId });
      } catch (wfErr: any) {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "capture_workflow_handoff_failed",
            docId,
            detail: String(wfErr?.message ?? wfErr),
          }),
        );
      }
    }

    // ── 12. Emit event ─────────────────────────────────────────────────────
    await deps.events.emit(EVENTS.DOCUMENT_INDEXED, {
      docId,
      docType: classifyResult.doc_type,
      confidence: classifyResult.confidence,
      source: aiSource,
      reviewFlag: finalReviewFlag,
      workflowId,
    });

    // ── 13. Build result ───────────────────────────────────────────────────
    const updatedDoc = await deps.knex("documents").where({ id: docId }).first();
    const finalDoc = { ...updatedDoc, review_flag: Boolean(updatedDoc.review_flag) };

    const suggestedNewType = buildNewTypeSuggestion(
      classifyResult.doc_type,
      classifyResult.confidence,
      registryCodes,
      extractResult.data,
    );

    return {
      ok: true,
      result: {
        document: finalDoc,
        classification: {
          doc_type: classifyResult.doc_type,
          confidence: classifyResult.confidence,
          review_flag: finalReviewFlag,
        },
        workflow_id: workflowId,
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
      },
    };
  } catch (err) {
    // Mark FAILED and re-throw so the caller (route → 500, job → retry) decides.
    await deps.knex("documents").where({ id: docId }).update({ extraction_status: "FAILED" }).catch(() => {});
    throw err;
  }
}

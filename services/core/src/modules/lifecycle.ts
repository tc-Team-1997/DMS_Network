import type { Knex } from "knex";
import type { LifecycleTrace, LifecycleStage } from "@zordms/types";

const STAGE_ACTIONS: Record<string, string[]> = {
  capture: ["CAPTURED", "DOCUMENT_CAPTURED"],
  index: ["INDEXED"],
  workflow: ["WORKFLOW_APPROVED", "APPROVED"],
  archive: ["ARCHIVED"],
  disposal: ["DISPOSAL_CERTIFIED"],
};
const STAGE_ORDER = ["capture", "index", "workflow", "archive", "disposal"];

// Fallback: a document at a given status implies earlier stages are complete.
const STATUS_RANK: Record<string, number> = {
  Active: 0,    // captured
  Indexed: 1,   // indexed
  Approved: 2,  // workflow
  Archived: 3,  // archive
  Disposed: 4,  // disposal
};

export async function buildLifecycleTrace(knex: Knex, docId: number): Promise<LifecycleTrace> {
  const doc = await knex("documents").where({ id: docId }).first();
  if (!doc) throw new Error(`document ${docId} not found`);

  const audits = await knex("audit_log")
    .where({ entity: "document", entity_id: String(docId) })
    .select("action", "actor_username", "created_at", "details").orderBy("id", "asc");

  // Use either the dedicated versions table (enterprise) or document_versions (Plan 2)
  let versions: any[] = [];
  const hasVersions = await knex.schema.hasTable("versions");
  if (hasVersions) {
    versions = await knex("versions").where({ document_id: docId })
      .select("version_no", "file_hash_sha256", "created_at", "created_by").orderBy("version_no", "asc");
  }
  if (versions.length === 0) {
    const hasDocVersions = await knex.schema.hasTable("document_versions");
    if (hasDocVersions) {
      versions = await knex("document_versions").where({ document_id: docId })
        .select("version_no", "file_hash_sha256", "created_at", "created_by").orderBy("version_no", "asc");
    }
  }

  const statusRank = STATUS_RANK[doc.status] ?? 0;

  const stages: LifecycleStage[] = STAGE_ORDER.map((stage, idx) => {
    const hit = audits.find((a) => STAGE_ACTIONS[stage].includes(a.action));
    const completeByStatus = idx <= statusRank;
    return {
      stage,
      at: hit?.created_at ? String(hit.created_at) : null,
      actor: hit?.actor_username ?? undefined,
      detail: hit?.details ?? undefined,
      complete: Boolean(hit) || completeByStatus,
    };
  });

  // Funnel across the corpus
  const allDocs = await knex("documents").select("status");
  const funnelCounts = { capture: 0, index: 0, workflow: 0, archive: 0, disposal: 0 };
  for (const d of allDocs) {
    const rank = STATUS_RANK[d.status] ?? -1;
    if (rank >= 0) funnelCounts.capture += 1;
    if (rank >= 1) funnelCounts.index += 1;
    if (rank >= 2) funnelCounts.workflow += 1;
    if (rank >= 3) funnelCounts.archive += 1;
    if (rank >= 4) funnelCounts.disposal += 1;
  }

  return {
    document_id: docId, doc_no: doc.doc_no ?? undefined, doc_type: doc.doc_type ?? "",
    stages, versions, funnel: funnelCounts,
  };
}

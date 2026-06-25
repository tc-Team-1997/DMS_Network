/**
 * Duplicate Detection
 *
 * Finds likely duplicates of a given document by:
 *   - Exact file_hash_sha256 match ("hash")
 *   - Same cid within any doc_type ("cid")
 *   - Same doc_no within the same doc_type ("doc_no")
 *
 * Excludes the source document itself. Excludes soft-deleted docs.
 */

import type { Knex } from "knex";

export interface DuplicateResult {
  id: number;
  title: string;
  doc_type: string | null;
  branch: string | null;
  ingest_timestamp: string | null;
  matchType: "hash" | "cid" | "doc_no";
}

export interface DuplicateFinderInput {
  docId: number;
  fileHashSha256: string;
  cid?: string | null;
  docNo?: string | null;
  docType?: string | null;
  /** Subset of ["hash","cid","doc_no"] to check. Defaults to all. */
  matchBy?: string[];
}

export async function findDuplicates(
  knex: Knex,
  input: DuplicateFinderInput,
): Promise<DuplicateResult[]> {
  const matchBy = input.matchBy ?? ["hash", "cid", "doc_no"];
  const results: DuplicateResult[] = [];
  const seen = new Set<number>();

  // ── Hash match ────────────────────────────────────────────────────────────
  if (matchBy.includes("hash") && input.fileHashSha256) {
    const rows = await knex("documents")
      .where({ file_hash_sha256: input.fileHashSha256 })
      .whereNot({ id: input.docId })
      .whereNot({ status: "Deleted" })
      .select("id", "title", "doc_type", "branch", "ingest_timestamp");
    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push({
          id: row.id,
          title: row.title,
          doc_type: row.doc_type ?? null,
          branch: row.branch ?? null,
          ingest_timestamp: row.ingest_timestamp ?? null,
          matchType: "hash",
        });
      }
    }
  }

  // ── CID match ─────────────────────────────────────────────────────────────
  if (matchBy.includes("cid") && input.cid) {
    const rows = await knex("documents")
      .where({ cid: input.cid })
      .whereNot({ id: input.docId })
      .whereNot({ status: "Deleted" })
      .select("id", "title", "doc_type", "branch", "ingest_timestamp");
    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push({
          id: row.id,
          title: row.title,
          doc_type: row.doc_type ?? null,
          branch: row.branch ?? null,
          ingest_timestamp: row.ingest_timestamp ?? null,
          matchType: "cid",
        });
      }
    }
  }

  // ── doc_no match (within same doc_type) ───────────────────────────────────
  if (matchBy.includes("doc_no") && input.docNo && input.docType) {
    const rows = await knex("documents")
      .where({ doc_no: input.docNo, doc_type: input.docType })
      .whereNot({ id: input.docId })
      .whereNot({ status: "Deleted" })
      .select("id", "title", "doc_type", "branch", "ingest_timestamp");
    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push({
          id: row.id,
          title: row.title,
          doc_type: row.doc_type ?? null,
          branch: row.branch ?? null,
          ingest_timestamp: row.ingest_timestamp ?? null,
          matchType: "doc_no",
        });
      }
    }
  }

  return results;
}

// ── Dedup Config helpers ──────────────────────────────────────────────────────

export interface DedupConfig {
  enabled: boolean;
  matchBy: string[];
  action: "flag" | "auto_version";
  fuzzyThreshold: number;
}

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  enabled: true,
  matchBy: ["hash", "cid"],
  action: "flag",
  fuzzyThreshold: 1.0,
};

export async function getDedupConfig(knex: Knex): Promise<DedupConfig> {
  const row = await knex("dedup_config").orderBy("id", "asc").first();
  if (!row) return { ...DEFAULT_DEDUP_CONFIG };
  return {
    enabled: Boolean(row.enabled),
    matchBy: (() => {
      try { return JSON.parse(row.match_by) as string[]; } catch { return ["hash", "cid"]; }
    })(),
    action: (row.action === "auto_version" ? "auto_version" : "flag") as "flag" | "auto_version",
    fuzzyThreshold: typeof row.fuzzy_threshold === "number" ? row.fuzzy_threshold : 1.0,
  };
}

export async function setDedupConfig(knex: Knex, cfg: Partial<DedupConfig>): Promise<DedupConfig> {
  const current = await getDedupConfig(knex);
  const merged: DedupConfig = {
    enabled: cfg.enabled !== undefined ? cfg.enabled : current.enabled,
    matchBy: cfg.matchBy !== undefined ? cfg.matchBy : current.matchBy,
    action: cfg.action !== undefined ? cfg.action : current.action,
    fuzzyThreshold: cfg.fuzzyThreshold !== undefined ? cfg.fuzzyThreshold : current.fuzzyThreshold,
  };

  const exists = await knex("dedup_config").first();
  if (exists) {
    await knex("dedup_config").where({ id: exists.id }).update({
      enabled: merged.enabled,
      match_by: JSON.stringify(merged.matchBy),
      action: merged.action,
      fuzzy_threshold: merged.fuzzyThreshold,
      updated_at: new Date().toISOString(),
    });
  } else {
    await knex("dedup_config").insert({
      enabled: merged.enabled,
      match_by: JSON.stringify(merged.matchBy),
      action: merged.action,
      fuzzy_threshold: merged.fuzzyThreshold,
    });
  }
  return merged;
}

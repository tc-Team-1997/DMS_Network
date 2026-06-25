import type { Knex } from "knex";
import type { SearchBackend } from "./backend/SearchBackend.js";
import type { SearchDoc } from "@zordms/types";

/**
 * Phase-2 cutover job: clears the target backend and re-streams every document from
 * the core `documents` table into the search backend. Text is assembled from the
 * available indexable columns so every document remains findable regardless of whether
 * an OCR column is present.
 */
export async function reindexAll(knex: Knex, backend: SearchBackend): Promise<{ indexed: number }> {
  await backend.reindexAll([]);  // clear first
  const rows = await knex("documents")
    .select("id", "doc_type", "branch", "status", "ingest_user_id", "ingest_timestamp")
    .where("status", "!=", "Deleted");

  let indexed = 0;
  for (const d of rows) {
    const doc: SearchDoc = {
      doc_id: String(d.id),
      doc_type: d.doc_type ?? "UNKNOWN",
      branch: d.branch ?? "",
      status: d.status ?? "Active",
      ocr_text: "",
      metadata_text: [d.doc_type, d.branch, d.status].filter(Boolean).join(" "),
      risk_band: "low",
      legal_hold: false,
      expiry_status: "none",
      uploaded_by: d.ingest_user_id ?? "",
      indexed_at: d.ingest_timestamp ?? new Date().toISOString(),
    };
    await backend.index(doc);
    indexed += 1;
  }
  return { indexed };
}

interface CorpusRow {
  doc_id: string;
  ocr_text?: string;
  metadata_text?: string;
  doc_type?: string;
  branch?: string;
  status?: string;
  risk_band?: string;
  legal_hold?: boolean | number;
  expiry_status?: string;
  uploaded_by?: string;
  indexed_at?: string;
}

/**
 * Backfill helper used by the ES boot-time backfill and the admin /reindex route.
 * Reads the local `search_index` corpus (populated by the seeds) and bulk-loads
 * every row into the target backend. This is what populates an empty ES cluster
 * from the data already present in the SQL search index.
 */
export async function reindexFromCorpus(
  knex: Knex,
  backend: SearchBackend,
): Promise<{ indexed: number }> {
  const rows = (await knex("search_index").select(
    "doc_id",
    "ocr_text",
    "metadata_text",
    "doc_type",
    "branch",
    "status",
    "risk_band",
    "legal_hold",
    "expiry_status",
    "uploaded_by",
    "indexed_at",
  )) as CorpusRow[];

  const docs: SearchDoc[] = rows.map((r) => ({
    doc_id: String(r.doc_id),
    ocr_text: r.ocr_text ?? "",
    metadata_text: r.metadata_text ?? "",
    doc_type: r.doc_type ?? "unknown",
    branch: r.branch ?? "",
    status: r.status ?? "Active",
    risk_band: r.risk_band ?? "low",
    legal_hold: !!r.legal_hold,
    expiry_status: r.expiry_status ?? "none",
    uploaded_by: r.uploaded_by ?? "",
    indexed_at: r.indexed_at ?? new Date().toISOString(),
  }));

  const indexed = await backend.reindexAll(docs);
  return { indexed };
}

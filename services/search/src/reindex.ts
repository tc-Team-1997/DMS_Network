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

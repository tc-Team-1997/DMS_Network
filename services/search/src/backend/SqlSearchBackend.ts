import type { Knex } from "knex";
import type { SearchBackend } from "./SearchBackend.js";
import type { SearchDoc, SearchQuery, SearchResults, SearchScope, SearchHit } from "@zordms/types";
import { buildTokensForDoc } from "../query/tokenize.js";
import { applyScope, applyFilters, applyTextMatch, scoreHit, paginate } from "../query/buildQuery.js";
import { aggregateFacets } from "../query/facets.js";

interface Row {
  doc_id: string; ocr_text: string; metadata_text: string; doc_type: string;
  branch: string; status: string; risk_band: string; legal_hold: boolean;
  expiry_status: string; uploaded_by: string; tokens: string; indexed_at: string;
}

export class SqlSearchBackend implements SearchBackend {
  readonly name = "sql" as const;
  constructor(private readonly knex: Knex) {}

  private rowFor(doc: SearchDoc): Row {
    return {
      doc_id: doc.doc_id, ocr_text: doc.ocr_text ?? "", metadata_text: doc.metadata_text ?? "",
      doc_type: doc.doc_type, branch: doc.branch, status: doc.status, risk_band: doc.risk_band ?? "low",
      legal_hold: !!doc.legal_hold, expiry_status: doc.expiry_status ?? "none", uploaded_by: doc.uploaded_by ?? "",
      tokens: buildTokensForDoc(doc), indexed_at: doc.indexed_at,
    };
  }

  async index(doc: SearchDoc): Promise<void> {
    const row = this.rowFor(doc);
    await this.knex("search_index").where({ doc_id: row.doc_id }).del();
    await this.knex("search_index").insert(row);
  }

  async bulkIndex(docs: SearchDoc[]): Promise<void> {
    for (const d of docs) await this.index(d);
  }

  async delete(docId: string): Promise<void> {
    await this.knex("search_index").where({ doc_id: docId }).del();
  }

  async reindexAll(docs: SearchDoc[]): Promise<number> {
    await this.knex("search_index").del();
    await this.bulkIndex(docs);
    return docs.length;
  }

  async search(query: SearchQuery, scope: SearchScope): Promise<SearchResults> {
    const started = Date.now();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    // Allow up to EXPORT_CAP (5000) rows when the caller explicitly requests a large page.
    // Normal user queries are still capped at 100 by the default maxSize.
    const maxSize = pageSize > 100 ? 5000 : 100;
    const { limit, offset } = paginate(page, pageSize, maxSize);
    const qTerms = query.text.toLowerCase().split(/\s+/).filter((t) => t && !["and", "or", "not"].includes(t));

    const predicate = (qb: Knex.QueryBuilder) => {
      applyScope(qb, scope);
      applyFilters(qb, query.filters ?? {});
      applyTextMatch(qb, query.text, query.mode);
      return qb;
    };

    // Total + facets over the full matched set (facet rows kept lean).
    const facetRows = (await predicate(this.knex("search_index"))
      .select("doc_type", "status", "branch", "risk_band")) as Array<{ doc_type: string; status: string; branch: string; risk_band: string }>;
    const total = facetRows.length;

    const rows = (await predicate(this.knex("search_index"))
      .select("doc_id", "ocr_text", "doc_type", "branch", "status", "tokens", "indexed_at")
      .orderBy("indexed_at", "desc")
      .limit(limit)
      .offset(offset)) as Array<Pick<Row, "doc_id" | "ocr_text" | "doc_type" | "branch" | "status" | "tokens" | "indexed_at">>;

    let hits: SearchHit[] = rows.map((r) => ({
      doc_id: r.doc_id, doc_type: r.doc_type, branch: r.branch, status: r.status,
      snippet: (r.ocr_text ?? "").slice(0, 160),
      score: scoreHit(r.tokens ?? "", qTerms),
      indexed_at: r.indexed_at,
    }));

    if (query.sort !== "recent") hits = hits.sort((a, b) => b.score - a.score);

    return {
      hits, total, page, pageSize, tookMs: Date.now() - started,
      facets: aggregateFacets(facetRows),
    };
  }
}

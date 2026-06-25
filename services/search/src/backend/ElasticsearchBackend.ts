import { Client } from "@elastic/elasticsearch";
import type { SearchBackend } from "./SearchBackend.js";
import type { SearchDoc, SearchQuery, SearchResults, SearchScope, SearchHit } from "@zordms/types";

// ---------------------------------------------------------------------------
// Minimal structural interface for the subset of the @elastic/elasticsearch
// client this backend uses. Tests inject a fake matching this shape so we never
// need a live ES cluster.
// ---------------------------------------------------------------------------
export interface EsAggBucket {
  key: string;
  doc_count: number;
}

export interface EsSearchResponse {
  hits: {
    total?: { value: number } | number;
    hits: Array<{
      _id: string;
      _score: number | null;
      _source?: Record<string, unknown>;
      highlight?: Record<string, string[]>;
    }>;
  };
  aggregations?: Record<string, { buckets: EsAggBucket[] }>;
}

export interface ElasticsearchClientLike {
  ping(): Promise<unknown>;
  index(args: {
    index: string;
    id: string;
    document: Record<string, unknown>;
    refresh?: boolean | "true" | "false" | "wait_for";
  }): Promise<unknown>;
  bulk(args: {
    refresh?: boolean | "true" | "false" | "wait_for";
    operations: Array<Record<string, unknown>>;
  }): Promise<{ errors?: boolean; items?: unknown[] }>;
  delete(args: {
    index: string;
    id: string;
    refresh?: boolean | "true" | "false" | "wait_for";
  }): Promise<unknown>;
  search(args: {
    index: string;
    from?: number;
    size?: number;
    query?: Record<string, unknown>;
    aggs?: Record<string, unknown>;
    highlight?: Record<string, unknown>;
    sort?: unknown;
    track_total_hits?: boolean;
  }): Promise<EsSearchResponse>;
  indices: {
    exists(args: { index: string }): Promise<boolean>;
    create(args: { index: string; mappings?: Record<string, unknown> }): Promise<unknown>;
    delete(args: { index: string; ignore_unavailable?: boolean }): Promise<unknown>;
  };
}

// Dimensions exposed as facets — identical to the SQL backend so the frontend
// receives the same { value, count } shape and is unchanged.
const FACET_DIMENSIONS = ["doc_type", "status", "branch", "risk_band"] as const;

// Explicit index mapping: free-text fields are analyzed for full-text search;
// facet/filter dimensions are keyword so term aggregations + term filters are exact.
export const INDEX_MAPPING: Record<string, unknown> = {
  properties: {
    doc_id: { type: "keyword" },
    ocr_text: { type: "text" },
    metadata_text: { type: "text" },
    doc_type: { type: "keyword" },
    branch: { type: "keyword" },
    status: { type: "keyword" },
    risk_band: { type: "keyword" },
    legal_hold: { type: "boolean" },
    expiry_status: { type: "keyword" },
    uploaded_by: { type: "keyword" },
    indexed_at: { type: "date" },
  },
};

export interface ElasticsearchBackendOptions {
  node?: string;
  index?: string;
  /** Inject a fake client in tests. When provided, `node` is ignored. */
  client?: ElasticsearchClientLike;
}

export class ElasticsearchBackend implements SearchBackend {
  readonly name = "es" as const;
  private readonly client: ElasticsearchClientLike;
  readonly indexName: string;

  constructor(options: ElasticsearchBackendOptions = {}) {
    this.client =
      options.client ??
      (new Client({
        node: options.node ?? "http://localhost:9200",
        // Keep the boot-time ping fast and non-retrying so an unreachable ES
        // fails quickly and we can fall back to SQL without hanging startup.
        maxRetries: 0,
        requestTimeout: 2000,
        pingTimeout: 2000,
      }) as unknown as ElasticsearchClientLike);
    this.indexName = options.index ?? "zordms-documents";
  }

  /** Liveness probe used by the boot-time fallback in server.ts. */
  async ping(): Promise<boolean> {
    await this.client.ping();
    return true;
  }

  /**
   * Ensure the index exists with the explicit mapping. Safe to call repeatedly
   * on startup — a no-op when the index already exists.
   */
  async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists) {
      await this.client.indices.create({ index: this.indexName, mappings: INDEX_MAPPING });
    }
  }

  private toDocument(doc: SearchDoc): Record<string, unknown> {
    return {
      doc_id: doc.doc_id,
      ocr_text: doc.ocr_text ?? "",
      metadata_text: doc.metadata_text ?? "",
      doc_type: doc.doc_type,
      branch: doc.branch,
      status: doc.status,
      risk_band: doc.risk_band ?? "low",
      legal_hold: !!doc.legal_hold,
      expiry_status: doc.expiry_status ?? "none",
      uploaded_by: doc.uploaded_by ?? "",
      indexed_at: doc.indexed_at,
    };
  }

  async index(doc: SearchDoc): Promise<void> {
    await this.client.index({
      index: this.indexName,
      id: doc.doc_id,
      document: this.toDocument(doc),
      refresh: true,
    });
  }

  async bulkIndex(docs: SearchDoc[]): Promise<void> {
    if (docs.length === 0) return;
    const operations: Array<Record<string, unknown>> = [];
    for (const d of docs) {
      operations.push({ index: { _index: this.indexName, _id: d.doc_id } });
      operations.push(this.toDocument(d));
    }
    await this.client.bulk({ refresh: true, operations });
  }

  async delete(docId: string): Promise<void> {
    await this.client.delete({ index: this.indexName, id: docId, refresh: true });
  }

  async reindexAll(docs: SearchDoc[]): Promise<number> {
    // Recreate the index from scratch so stale docs cannot linger, then bulk load.
    await this.client.indices.delete({ index: this.indexName, ignore_unavailable: true });
    await this.client.indices.create({ index: this.indexName, mappings: INDEX_MAPPING });
    await this.bulkIndex(docs);
    return docs.length;
  }

  private buildQuery(query: SearchQuery, scope: SearchScope): Record<string, unknown> {
    const filter: Array<Record<string, unknown>> = [];

    // BRANCH SCOPING: a viewer without cross-branch rights sees only their branch.
    if (!scope.crossBranch && scope.branch) {
      filter.push({ term: { branch: scope.branch } });
    }

    const f = query.filters ?? {};
    if (f.doc_type) filter.push({ term: { doc_type: f.doc_type } });
    if (f.branch) filter.push({ term: { branch: f.branch } });
    if (f.status) filter.push({ term: { status: f.status } });
    if (f.risk_band) filter.push({ term: { risk_band: f.risk_band } });
    if (f.legal_hold != null) filter.push({ term: { legal_hold: f.legal_hold } });
    if (f.expiry_status) filter.push({ term: { expiry_status: f.expiry_status } });

    const text = (query.text ?? "").trim();
    const must: Array<Record<string, unknown>> =
      text === ""
        ? [{ match_all: {} }]
        : [
            {
              multi_match: {
                query: text,
                fields: ["ocr_text", "metadata_text", "doc_type"],
                fuzziness: query.mode === "fuzzy" ? "AUTO" : 0,
              },
            },
          ];

    return { bool: { must, filter } };
  }

  async search(query: SearchQuery, scope: SearchScope): Promise<SearchResults> {
    const started = Date.now();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const from = (page - 1) * pageSize;

    const esQuery = this.buildQuery(query, scope);

    const aggs: Record<string, unknown> = {};
    for (const dim of FACET_DIMENSIONS) {
      aggs[dim] = { terms: { field: dim, size: 50 } };
    }

    const res = await this.client.search({
      index: this.indexName,
      from,
      size: pageSize,
      query: esQuery,
      aggs,
      highlight: { fields: { ocr_text: {}, metadata_text: {} } },
      sort: query.sort === "recent" ? [{ indexed_at: { order: "desc" } }] : undefined,
      track_total_hits: true,
    });

    const rawHits = res.hits?.hits ?? [];
    const hits: SearchHit[] = rawHits.map((h) => {
      const src = h._source ?? {};
      const highlight = h.highlight?.ocr_text?.[0] ?? h.highlight?.metadata_text?.[0];
      const fallback = (src.ocr_text as string) ?? (src.metadata_text as string) ?? "";
      return {
        doc_id: (src.doc_id as string) ?? h._id,
        doc_type: (src.doc_type as string) ?? "",
        branch: (src.branch as string) ?? "",
        status: (src.status as string) ?? "",
        snippet: (highlight ?? fallback).slice(0, 160),
        score: Number(h._score ?? 0),
        indexed_at: (src.indexed_at as string) ?? new Date().toISOString(),
      };
    });

    const total =
      typeof res.hits?.total === "number"
        ? res.hits.total
        : res.hits?.total?.value ?? hits.length;

    return {
      hits,
      total,
      page,
      pageSize,
      tookMs: Date.now() - started,
      facets: this.parseFacets(res.aggregations),
    };
  }

  private parseFacets(
    aggregations?: Record<string, { buckets: EsAggBucket[] }>,
  ): Record<string, Array<{ value: string; count: number }>> {
    const out: Record<string, Array<{ value: string; count: number }>> = {};
    for (const dim of FACET_DIMENSIONS) {
      const buckets = aggregations?.[dim]?.buckets ?? [];
      out[dim] = buckets.map((b) => ({ value: b.key, count: b.doc_count }));
    }
    return out;
  }
}

import { Client } from "@elastic/elasticsearch";
import type { SearchBackend } from "./SearchBackend.js";
import type { SearchDoc, SearchQuery, SearchResults, SearchScope, SearchHit } from "@zordms/types";

export interface EsClient {
  index(args: { index: string; id: string; document: Record<string, unknown>; refresh?: boolean | "true" | "false" | "wait_for" }): Promise<unknown>;
  search(args: { index: string; size?: number; query?: Record<string, unknown>; highlight?: Record<string, unknown> }): Promise<{ hits: { hits: Array<{ _id: string; _score: number; _source: Record<string, unknown>; highlight?: Record<string, string[]> }> } }>;
  delete(args: { index: string; id: string; refresh?: boolean | "true" | "false" | "wait_for" }): Promise<unknown>;
  indices: {
    delete(args: { index: string; ignore_unavailable?: boolean }): Promise<unknown>;
    create(args: { index: string }): Promise<unknown>;
  };
}

/**
 * Phase-2 Elasticsearch backend. Accepts an optional injected client so tests
 * can pass a fake. When no client is provided and ES_NODE is not configured,
 * it falls back to localhost. Pass `{ node }` in constructor options to override.
 */
export class EsSearchBackend implements SearchBackend {
  readonly name = "es" as const;
  private readonly client: EsClient;
  private readonly indexName: string;
  private readonly isStub: boolean;

  constructor(options?: { node?: string; index?: string; client?: EsClient }) {
    if (options?.client) {
      this.client = options.client;
      this.isStub = false;
    } else if (options?.node) {
      this.client = new Client({ node: options.node }) as unknown as EsClient;
      this.isStub = false;
    } else {
      // Default stub: fails fast with a descriptive error (same as before)
      this.client = null as unknown as EsClient;
      this.isStub = true;
    }
    this.indexName = options?.index ?? process.env.ES_INDEX ?? "zordms-documents";
  }

  private fail(): never { throw new Error("es_backend_not_enabled"); }

  async index(doc: SearchDoc): Promise<void> {
    if (this.isStub) this.fail();
    await this.client.index({
      index: this.indexName,
      id: doc.doc_id,
      document: {
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
      },
      refresh: true,
    });
  }

  async bulkIndex(docs: SearchDoc[]): Promise<void> {
    if (this.isStub) this.fail();
    for (const d of docs) await this.index(d);
  }

  async delete(docId: string): Promise<void> {
    if (this.isStub) this.fail();
    await this.client.delete({ index: this.indexName, id: docId, refresh: true });
  }

  async reindexAll(docs: SearchDoc[]): Promise<number> {
    if (this.isStub) this.fail();
    await this.clear();
    await this.bulkIndex(docs);
    return docs.length;
  }

  async search(query: SearchQuery, scope: SearchScope): Promise<SearchResults> {
    if (this.isStub) this.fail();
    const started = Date.now();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const maxSize = Math.min(pageSize, 100);

    const esQuery: Record<string, unknown> = {
      bool: {
        must: [
          { multi_match: { query: query.text, fields: ["ocr_text", "metadata_text", "doc_type"], fuzziness: "AUTO" } },
        ],
        filter: [
          ...(!scope.crossBranch && scope.branch ? [{ term: { branch: scope.branch } }] : []),
          ...(query.filters?.doc_type ? [{ term: { doc_type: query.filters.doc_type } }] : []),
          ...(query.filters?.status ? [{ term: { status: query.filters.status } }] : []),
          ...(query.filters?.risk_band ? [{ term: { risk_band: query.filters.risk_band } }] : []),
          ...(query.filters?.legal_hold != null ? [{ term: { legal_hold: query.filters.legal_hold } }] : []),
        ],
      },
    };

    const res = await this.client.search({
      index: this.indexName,
      size: maxSize,
      query: esQuery,
      highlight: { fields: { ocr_text: {} } },
    });

    const rawHits = res.hits?.hits ?? [];
    const hits: SearchHit[] = rawHits.map((h) => ({
      doc_id: h._id,
      doc_type: (h._source?.doc_type as string) ?? "",
      branch: (h._source?.branch as string) ?? "",
      status: (h._source?.status as string) ?? "",
      snippet: (h.highlight?.ocr_text?.[0] ?? (h._source?.ocr_text as string ?? "")).slice(0, 160),
      score: Number(h._score ?? 0),
      indexed_at: (h._source?.indexed_at as string) ?? new Date().toISOString(),
    }));

    return {
      hits,
      total: hits.length,
      page,
      pageSize,
      tookMs: Date.now() - started,
      facets: {},
    };
  }

  async clear(): Promise<void> {
    if (this.isStub) this.fail();
    try { await this.client.indices.delete({ index: this.indexName, ignore_unavailable: true }); } catch { /* may not exist */ }
    await this.client.indices.create({ index: this.indexName });
  }
}

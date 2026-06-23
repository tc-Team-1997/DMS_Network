import type { SearchBackend } from "./SearchBackend.js";
import type { SearchDoc, SearchQuery, SearchResults, SearchScope } from "../types.js";

/**
 * Phase-2 Elasticsearch backend. Same interface as SqlSearchBackend, so the
 * service is backend-agnostic. Until Phase 2 injects a live @elastic/elasticsearch
 * client, every method fails fast with es_backend_not_enabled.
 */
export class EsSearchBackend implements SearchBackend {
  readonly name = "es" as const;
  private fail(): never { throw new Error("es_backend_not_enabled"); }

  async index(_doc: SearchDoc): Promise<void> { this.fail(); }
  async bulkIndex(_docs: SearchDoc[]): Promise<void> { this.fail(); }
  async search(_query: SearchQuery, _scope: SearchScope): Promise<SearchResults> { this.fail(); }
  async delete(_docId: string): Promise<void> { this.fail(); }
  async reindexAll(_docs: SearchDoc[]): Promise<number> { this.fail(); }
}

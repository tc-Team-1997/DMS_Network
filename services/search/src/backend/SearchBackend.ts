import type { SearchDoc, SearchQuery, SearchResults, SearchScope } from "@zordms/types";

export interface SearchBackend {
  readonly name: "sql" | "es";
  index(doc: SearchDoc): Promise<void>;
  bulkIndex(docs: SearchDoc[]): Promise<void>;
  search(query: SearchQuery, scope: SearchScope): Promise<SearchResults>;
  delete(docId: string): Promise<void>;
  reindexAll(docs: SearchDoc[]): Promise<number>;
}

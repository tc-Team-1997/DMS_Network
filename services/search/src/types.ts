// Search domain types — local to @zordms/search.
// These will eventually be published to @zordms/types in a shared task.

export interface SearchDoc {
  doc_id: string;
  ocr_text: string;
  metadata_text: string;
  doc_type: string;
  branch: string;
  status: string;
  risk_band: string;           // low | medium | high
  legal_hold: boolean;
  expiry_status: string;       // none | le30 | le90 | expired
  uploaded_by: string;
  indexed_at: string;          // ISO timestamp
}

export type SearchMode = "fulltext" | "boolean" | "wildcard" | "fuzzy" | "semantic";

export interface SearchFilters {
  doc_type?: string;
  status?: string;
  branch?: string;
  uploaded_by?: string;
  risk_band?: string;
  legal_hold?: boolean;
  expiry_status?: string;      // none | le30 | le90 | expired
  date_from?: string;          // ISO
  date_to?: string;            // ISO
}

export interface SearchQuery {
  text: string;
  mode: SearchMode;
  filters?: SearchFilters;
  page?: number;
  pageSize?: number;
  sort?: "relevance" | "recent";
}

export interface SearchScope {
  branch?: string;
  region?: string;
  crossBranch: boolean;
}

export interface SearchHit {
  doc_id: string;
  doc_type: string;
  branch: string;
  status: string;
  snippet: string;
  score: number;
  indexed_at: string;
}

export interface SearchResults {
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  tookMs: number;
  facets?: Record<string, Array<{ value: string; count: number }>>;
}

export type SavedSearchVisibility = "private" | "public";

export interface SavedSearch {
  id: number;
  user_id: number;
  name: string;
  query_json: SearchQuery;
  visibility: SavedSearchVisibility;
}

export interface SaveSearchRequest {
  name: string;
  query: SearchQuery;
  visibility: SavedSearchVisibility;
}

const SEARCH_MODES: SearchMode[] = ["fulltext", "boolean", "wildcard", "fuzzy", "semantic"];

export function isSearchQuery(x: unknown): x is SearchQuery {
  const q = x as SearchQuery;
  return !!q && typeof q.text === "string" && SEARCH_MODES.includes(q.mode);
}

/**
 * Search service API helpers — talks to /svc/search (proxy -> :4004)
 * Named searchApi.ts to avoid collision with other parallel agents.
 */
import { http, SVC } from "./http.js";

const BASE = SVC.search;

export type SearchMode = "fulltext" | "boolean" | "wildcard" | "fuzzy" | "semantic";

export interface SearchFilters {
  doc_type?: string;
  status?: string;
  branch?: string;
  uploaded_by?: string;
  risk_band?: string;
  legal_hold?: boolean;
  expiry_status?: string;
  date_from?: string;
  date_to?: string;
}

export interface SearchQuery {
  text: string;
  mode: SearchMode;
  filters?: SearchFilters;
  page?: number;
  pageSize?: number;
  sort?: "relevance" | "recent";
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

export interface FacetItem {
  value: string;
  count: number;
}

export interface SearchResults {
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  tookMs: number;
  facets?: Record<string, FacetItem[]>;
}

export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  query_json: SearchQuery;
  visibility: "private" | "public";
}

export const searchApi = {
  /** POST /search — full text / boolean / wildcard / fuzzy / semantic */
  query: (q: SearchQuery) =>
    http.post<SearchResults>(`${BASE}/search`, q),

  /** GET /facets — facet dimensions for the caller's scope */
  facets: () =>
    http.get<{ facets: Record<string, FacetItem[]> }>(`${BASE}/facets`),

  /** POST /saved — save a query */
  saveSearch: (name: string, query: SearchQuery, visibility: "private" | "public") =>
    http.post<SavedSearch>(`${BASE}/saved`, { name, query, visibility }),

  /** GET /saved — list saved searches visible to the caller */
  listSaved: () =>
    http.get<{ saved: SavedSearch[] }>(`${BASE}/saved`),

  /** POST /saved/:id/run */
  runSaved: (id: string) =>
    http.post<SearchResults>(`${BASE}/saved/${id}/run`),

  /**
   * POST /search/export.csv — export search results as a CSV blob.
   * Returns a Blob that the caller should trigger as a file download.
   */
  exportCsv: async (q: SearchQuery): Promise<Blob> => {
    const { getToken } = await import("./client.js");
    const token = getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${BASE}/search/export.csv`, {
      method: "POST",
      headers,
      body: JSON.stringify(q),
    });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.blob();
  },
};

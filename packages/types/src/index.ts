export type Permission = string; // "resource:action"

export interface Role { id: string; name: string; description?: string; system?: boolean; }

export interface User {
  id: string; username: string; full_name?: string; email?: string;
  branch?: string; region?: string; mfa_enabled: boolean; status: "Active" | "Locked";
}

export interface AuthUser {
  id: string; username: string; roles: string[]; permissions: Permission[];
  branch?: string; region?: string;
}

export interface LoginRequest { username: string; password: string; totp?: string; }
export interface LoginResponse { token: string; user: AuthUser; mfaRequired?: boolean; }

export interface CreateUserRequest {
  username: string; password: string; full_name?: string; email?: string;
  branch?: string; region?: string; roles: string[];
}

export * from "./enterprise.js";

export function isAuthUser(x: unknown): x is AuthUser {
  const u = x as AuthUser;
  return !!u && typeof u.id === "string" && typeof u.username === "string"
    && Array.isArray(u.roles) && Array.isArray(u.permissions)
    && u.roles.every(r => typeof r === "string")
    && u.permissions.every(p => typeof p === "string");
}

// ---------------------------------------------------------------------------
// Search domain types (consolidated from @zordms/search)
// ---------------------------------------------------------------------------

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
  id: string;
  user_id: string;
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

// ---------------------------------------------------------------------------
// Integration domain types (consolidated from @zordms/integration)
// ---------------------------------------------------------------------------

export type IntegrationDirection = "outbound" | "inbound";

export interface IntegrationLog {
  id: string;
  system: string;
  endpoint: string;
  method: string;
  status: number;
  latency_ms: number;
  direction: IntegrationDirection;
  success: boolean;
  error?: string | null;
  created_at?: string;
}

export interface IntegrationConfigRow {
  id: string;
  system: string;
  base_url?: string | null;
  auth_type: "none" | "bearer" | "hmac" | "basic";
  secret?: string | null;
  enabled: boolean;
  created_at?: string;
}

export interface OutboundWebhook {
  id: string;
  url: string;
  events: string[];
  auth_method: "hmac" | "none";
  enabled: boolean;
  created_at?: string;
}

export interface ConnectedSystem {
  system: string;
  base_url?: string | null;
  enabled: boolean;
  status: "up" | "down" | "mock" | "disabled";
  lastCallAt?: string | null;
  recentErrors: number;
}

export interface ConnectorResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  mock?: boolean;
}

export const INTEGRATION_EVENTS = [
  "cbs.customer.updated",
  "los.loan.created",
  "kyc.result",
] as const;

export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

export function isConnectorResult(x: unknown): x is ConnectorResult {
  const r = x as ConnectorResult;
  return !!r && typeof r.ok === "boolean" && typeof r.status === "number";
}

import { z } from 'zod';
import { get, post, del, patch } from '@/lib/http';
import {
  SearchResponseSchema,
  SavedSearchSchema,
  SavedSearchListSchema,
  CmdkResponseSchema,
  OkSchema,
  RebuildFtsResponseSchema,
  SearchV2ResponseSchema,
  type SearchFilters,
  type CreateSavedSearchBody,
  type SearchResponse,
  type SavedSearch,
  type CmdkResponse,
  type SearchV2Response,
  type SearchV2Filters,
} from './schemas';

// ---------------------------------------------------------------------------
// GET /spa/api/search
// ---------------------------------------------------------------------------

export function fetchSearch(filters: SearchFilters): Promise<SearchResponse> {
  const params: Record<string, unknown> = {
    q:         filters.q,
    page:      filters.page,
    page_size: filters.page_size,
  };

  // Array params — send as repeated keys with [] suffix.
  if (filters.doc_type.length > 0)   params['doc_type[]']  = filters.doc_type;
  if (filters.branch.length > 0)     params['branch[]']    = filters.branch;
  if (filters.risk_band.length > 0)  params['risk_band[]'] = filters.risk_band;
  if (filters.status.length > 0)     params['status[]']    = filters.status;

  if (filters.uploaded_after)     params.uploaded_after     = filters.uploaded_after;
  if (filters.uploaded_before)    params.uploaded_before    = filters.uploaded_before;
  if (filters.expiry_within_days) params.expiry_within_days = filters.expiry_within_days;
  if (filters.customer_cid)       params.customer_cid       = filters.customer_cid;

  return get('/spa/api/search', SearchResponseSchema, params);
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

export function fetchSavedSearches(): Promise<SavedSearch[]> {
  return get('/spa/api/search/saved', SavedSearchListSchema);
}

export function createSavedSearch(body: CreateSavedSearchBody): Promise<SavedSearch> {
  return post('/spa/api/search/saved', body, SavedSearchSchema);
}

export function touchSavedSearch(id: number): Promise<SavedSearch> {
  return patch(`/spa/api/search/saved/${id}/touch`, {}, SavedSearchSchema);
}

export function deleteSavedSearch(id: number): Promise<z.infer<typeof OkSchema>> {
  return del(`/spa/api/search/saved/${id}`, OkSchema);
}

// ---------------------------------------------------------------------------
// Cmd-K
// ---------------------------------------------------------------------------

export function fetchCmdk(q: string): Promise<CmdkResponse> {
  return post('/spa/api/search/cmdk', { q }, CmdkResponseSchema);
}

// ---------------------------------------------------------------------------
// Admin — rebuild FTS index
// ---------------------------------------------------------------------------

export function rebuildFts(): Promise<z.infer<typeof RebuildFtsResponseSchema>> {
  return post('/spa/api/admin/search/rebuild-fts', {}, RebuildFtsResponseSchema);
}

// ---------------------------------------------------------------------------
// GET /spa/api/search/v2 — Plan 3 (Wave-E1) Task #7
// ---------------------------------------------------------------------------

export function fetchSearchV2(filters: SearchV2Filters): Promise<SearchV2Response> {
  const params: Record<string, unknown> = { q: filters.q };
  if (filters.type)   params.type   = filters.type;
  if (filters.branch) params.branch = filters.branch;
  if (filters.status) params.status = filters.status;
  return get('/spa/api/search/v2', SearchV2ResponseSchema, params);
}

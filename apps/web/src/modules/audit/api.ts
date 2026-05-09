/**
 * Audit Log v2 — typed fetch wrappers.
 *
 * All requests go through src/lib/http.ts (zod-validated axios).
 * No raw fetch(), no untyped responses.
 */

import { get, post } from '@/lib/http';
import {
  EventsResponseSchema,
  SearchResponseSchema,
  PivotResponseSchema,
  VerifyChainResponseSchema,
  AnchorResponseSchema,
  type AuditFilters,
  type PivotBy,
} from './schemas';

const BASE = '/spa/api/audit';

// ---------------------------------------------------------------------------
// Events (paginated, filtered)
// ---------------------------------------------------------------------------

export function fetchAuditEvents(filters: AuditFilters = {}) {
  // Build a params object, omitting undefined / empty-string values so the
  // query string stays clean.
  const params: Record<string, unknown> = {};
  if (filters.entity_type) params['entity_type'] = filters.entity_type;
  if (filters.action)      params['action']      = filters.action;
  if (filters.actor)       params['actor']       = filters.actor;
  if (filters.from)        params['from']        = filters.from;
  if (filters.to)          params['to']          = filters.to;
  if (filters.result)      params['result']      = filters.result;
  if (filters.page)        params['page']        = filters.page;
  if (filters.per_page)    params['per_page']    = filters.per_page;

  return get(`${BASE}/events`, EventsResponseSchema, params);
}

// ---------------------------------------------------------------------------
// FTS full-text search
// ---------------------------------------------------------------------------

export function searchAuditEvents(q: string, page = 1, perPage = 50) {
  return get(`${BASE}/search`, SearchResponseSchema, { q, page, per_page: perPage });
}

// ---------------------------------------------------------------------------
// Entity pivot
// ---------------------------------------------------------------------------

export function fetchAuditPivot(by: PivotBy) {
  return get(`${BASE}/pivot`, PivotResponseSchema, { by });
}

// ---------------------------------------------------------------------------
// Chain verification (server-assisted pre-check)
// ---------------------------------------------------------------------------

export function verifyChain(limit?: number) {
  return post(`${BASE}/verify-chain`, limit !== undefined ? { limit } : {}, VerifyChainResponseSchema);
}

// ---------------------------------------------------------------------------
// OTS anchor
// ---------------------------------------------------------------------------

export function anchorChain(headHash: string | null) {
  return post(`${BASE}/anchor`, { head_hash: headHash }, AnchorResponseSchema);
}

// ---------------------------------------------------------------------------
// Export (triggers browser download — not a typed JSON response)
// Builds the URL; caller sets window.location or opens in a new tab.
// ---------------------------------------------------------------------------

export type ExportFormat = 'json' | 'csv' | 'pdf';

export function buildExportUrl(format: ExportFormat, filters: Omit<AuditFilters, 'page' | 'per_page'> = {}): string {
  const params = new URLSearchParams({ format });
  if (filters.entity_type) params.set('entity_type', filters.entity_type);
  if (filters.action)      params.set('action', filters.action);
  if (filters.actor)       params.set('actor', filters.actor);
  if (filters.from)        params.set('from', filters.from);
  if (filters.to)          params.set('to', filters.to);
  if (filters.result)      params.set('result', filters.result);
  return `${BASE}/export?${params.toString()}`;
}

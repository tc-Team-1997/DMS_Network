/**
 * CBS API layer — all fetches go through lib/http.ts with Zod validation.
 * Paths: /spa/api/cbs/*  (Node SPA mirror of Python /api/v1/cbs/*).
 */

import { get, post } from '@/lib/http';
import {
  CbsAccountsResponse,
  CbsCustomer,
  CbsHealth,
  CbsInvalidateCacheResponse,
  CbsLinkResponse,
  type CbsLinkRequest,
} from './schemas';

// ── Health ─────────────────────────────────────────────────────────────────

/** GET /spa/api/cbs/health — no auth required; used by CbsHealthBadge. */
export async function fetchCbsHealth(): Promise<CbsHealth> {
  return get('/spa/api/cbs/health', CbsHealth);
}

// ── Customer ───────────────────────────────────────────────────────────────

/**
 * GET /spa/api/cbs/customers/:cif — requires cbs:read permission.
 * Returns the customer master; `raw` field is stripped by Node.
 */
export async function fetchCbsCustomer(cif: string): Promise<CbsCustomer> {
  return get(`/spa/api/cbs/customers/${encodeURIComponent(cif)}`, CbsCustomer);
}

/**
 * GET /spa/api/cbs/customers/:cif/accounts — lazy-fetched when user expands.
 * Requires cbs:read permission.
 */
export async function fetchCbsAccounts(cif: string): Promise<CbsAccountsResponse> {
  return get(
    `/spa/api/cbs/customers/${encodeURIComponent(cif)}/accounts`,
    CbsAccountsResponse,
  );
}

/**
 * POST /spa/api/cbs/customers/:cif/invalidate-cache — requires cbs:admin.
 * Forces a fresh pull from T24 by busting the 5-min cache.
 */
export async function invalidateCbsCustomerCache(
  cif: string,
): Promise<CbsInvalidateCacheResponse> {
  return post(
    `/spa/api/cbs/customers/${encodeURIComponent(cif)}/invalidate-cache`,
    {},
    CbsInvalidateCacheResponse,
  );
}

// ── Link document ──────────────────────────────────────────────────────────

/**
 * POST /spa/api/cbs/customers/:cif/link-document — requires cbs:write.
 * Links a DMS document to a T24 transaction; idempotent on same doc+ref.
 */
export async function linkDocumentToCbs(
  cif: string,
  body: CbsLinkRequest,
): Promise<CbsLinkResponse> {
  return post(
    `/spa/api/cbs/customers/${encodeURIComponent(cif)}/link-document`,
    body,
    CbsLinkResponse,
  );
}

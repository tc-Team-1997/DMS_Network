import { get, patch, post } from '@/lib/http';
import {
  AmlSummary,
  DecideResponseSchema,
  HitsResponseSchema,
  ScreenCustomerResponseSchema,
  ScreeningsResponseSchema,
  WatchlistPatchResponseSchema,
  WatchlistRefreshResponseSchema,
  WatchlistsResponseSchema,
  type DecisionEnum,
  type HitsResponse,
  type ScreeningsResponse,
  type Watchlist,
} from './schemas';

// ── Watchlists ────────────────────────────────────────────────────────────────

export function fetchWatchlists(): Promise<Watchlist[]> {
  return get('/spa/api/aml/watchlists', WatchlistsResponseSchema);
}

export function patchWatchlistThreshold(
  id: number,
  match_threshold: number,
): Promise<Watchlist> {
  return patch(
    `/spa/api/aml/watchlists/${id}`,
    { match_threshold },
    WatchlistPatchResponseSchema,
  );
}

export function refreshWatchlists() {
  return post(
    '/spa/api/aml/watchlists/refresh',
    {},
    WatchlistRefreshResponseSchema,
  );
}

// ── Hits ──────────────────────────────────────────────────────────────────────

export function fetchOpenHits(params?: {
  cursor?: string;
  limit?: number;
}): Promise<HitsResponse> {
  return get('/spa/api/aml/hits', HitsResponseSchema, {
    decision: 'open',
    ...(params?.cursor !== undefined ? { cursor: params.cursor } : {}),
    limit: params?.limit ?? 50,
  });
}

export function decideHit(
  hitId: number,
  decision: DecisionEnum,
  notes: string,
) {
  return post(
    `/spa/api/aml/hits/${hitId}/decide`,
    { decision, reviewer_notes: notes },
    DecideResponseSchema,
  );
}

// ── Screenings ────────────────────────────────────────────────────────────────

export function fetchScreenings(params?: {
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<ScreeningsResponse> {
  return get('/spa/api/aml/screenings', ScreeningsResponseSchema, {
    ...(params?.status ? { status: params.status } : {}),
    ...(params?.cursor !== undefined ? { cursor: params.cursor } : {}),
    limit: params?.limit ?? 50,
  });
}

export function triggerScreening(customer_cid: string) {
  return post(
    '/spa/api/aml/screen',
    { customer_cid },
    ScreenCustomerResponseSchema,
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function fetchAmlSummary() {
  return get('/spa/api/aml/stats', AmlSummary);
}

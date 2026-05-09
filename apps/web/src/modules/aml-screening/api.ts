import { get, patch, post } from '@/lib/http';
import {
  AmlSummary,
  DecideResponseSchema,
  HitHistoryResponseSchema,
  HitsResponseSchema,
  SarSubmitResponseSchema,
  ScreenCustomerResponseSchema,
  ScreeningsResponseSchema,
  SuppressionResponseSchema,
  WatchlistPatchResponseSchema,
  WatchlistRefreshResponseSchema,
  WatchlistsResponseSchema,
  type DecisionEnum,
  type HitHistoryResponse,
  type HitsResponse,
  type SarSubmitResponse,
  type ScreeningsResponse,
  type SuppressionResponse,
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

// ── v2: Hit history (for History tab in HitDecideV2Modal) ─────────────────────

export function fetchHitHistory(hitId: number): Promise<HitHistoryResponse> {
  return get(`/spa/api/aml/hits/${hitId}/history`, HitHistoryResponseSchema);
}

// ── v2: Suppress (Cleared + Suppress action) ──────────────────────────────────

export function suppressHit(
  hitId: number,
  reason: string,
  suppressDays?: number,
): Promise<SuppressionResponse> {
  return post(
    `/spa/api/aml/hits/${hitId}/suppress`,
    {
      reason,
      ...(suppressDays !== undefined ? { suppress_days: suppressDays } : {}),
    },
    SuppressionResponseSchema,
  );
}

// ── v2: SAR submit (stub) ─────────────────────────────────────────────────────

export function submitSar(hitId: number): Promise<SarSubmitResponse> {
  return post(
    `/spa/api/aml/hits/${hitId}/sar-submit`,
    {},
    SarSubmitResponseSchema,
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

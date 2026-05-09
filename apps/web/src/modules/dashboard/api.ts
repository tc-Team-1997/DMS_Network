/**
 * Dashboard v2 API module.
 *
 * Replaces the v1 multi-fetch pattern (5 separate endpoints) with a single
 * GET /spa/api/dashboard/kpis call that returns all tile + chart data.
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/http';
import { KpisResponseSchema, type Comparator, type KpisResponse, type Timeframe } from './schemas';

export type { KpisResponse };

// ─── Query key factory ────────────────────────────────────────────────────────

export const dashboardKeys = {
  kpis: (tf: Timeframe, compare: Comparator) =>
    ['dashboard', 'kpis', tf, compare] as const,
};

// ─── Fetcher ──────────────────────────────────────────────────────────────────

export function fetchKpis(tf: Timeframe, compare: Comparator): Promise<KpisResponse> {
  return get('/spa/api/dashboard/kpis', KpisResponseSchema, {
    tf,
    compare,
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useKpis(
  tf: Timeframe,
  compare: Comparator,
  refreshIntervalMs: number,
) {
  return useQuery({
    queryKey:        dashboardKeys.kpis(tf, compare),
    queryFn:         () => fetchKpis(tf, compare),
    staleTime:       refreshIntervalMs,
    refetchInterval: refreshIntervalMs,
  });
}

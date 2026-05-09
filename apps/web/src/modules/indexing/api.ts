import { z } from 'zod';
import { get, http, del } from '@/lib/http';
import { OkSchema } from '@/lib/schemas';
import {
  IndexingRowSchema,
  IndexingStatsSchema,
  IndexingPatchSchema,
  AnalysisResponseSchema,
  ClaimResponseSchema,
  type IndexingPatch,
  type IndexingRow,
  type IndexingStats,
  type AnalysisResponse,
  type ClaimResponse,
} from './schemas';

// Re-export types callers need.
export type { IndexingPatch, IndexingRow, IndexingStats, AnalysisResponse, ClaimResponse };

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface IndexingFilters {
  low_conf?: 0 | 1;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Queue + stats
// ---------------------------------------------------------------------------

export const fetchIndexingQueue = (f: IndexingFilters = {}): Promise<IndexingRow[]> =>
  get('/spa/api/indexing', z.array(IndexingRowSchema), f as Record<string, unknown>);

export const fetchIndexingStats = (): Promise<IndexingStats> =>
  get('/spa/api/indexing/stats', IndexingStatsSchema);

// ---------------------------------------------------------------------------
// Analysis (per-field AI confidence from metadata_json._ai_fields)
// ---------------------------------------------------------------------------

export const fetchIndexingAnalysis = (id: number): Promise<AnalysisResponse> =>
  get(`/spa/api/indexing/${id}/analysis`, AnalysisResponseSchema);

// ---------------------------------------------------------------------------
// Save edits
// ---------------------------------------------------------------------------

export const patchIndexingRow = async (id: number, patch: IndexingPatch): Promise<{ ok: true }> => {
  const parsed = IndexingPatchSchema.parse(patch);
  const { data } = await http.patch(`/spa/api/indexing/${id}`, parsed);
  return OkSchema.parse(data);
};

// ---------------------------------------------------------------------------
// Claim / release
// ---------------------------------------------------------------------------

export const claimIndexingDoc = async (id: number): Promise<ClaimResponse> => {
  const { data } = await http.post<unknown>(`/spa/api/indexing/${id}/claim`, {});
  return ClaimResponseSchema.parse(data);
};

export const releaseIndexingDoc = async (id: number): Promise<{ ok: true }> =>
  del(`/spa/api/indexing/${id}/claim`, OkSchema);

/**
 * Beacon release — called in beforeunload via navigator.sendBeacon.
 * sendBeacon only supports POST; we POST to the /release alias endpoint.
 * Returns void (fire-and-forget — beacon callbacks are not awaited by the browser).
 */
export function beaconRelease(id: number): void {
  const url = `/spa/api/indexing/${id}/claim/release`;
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(url);
  }
}

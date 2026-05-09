/**
 * Zod schemas for Dashboard v2 — contract with GET /spa/api/dashboard/kpis.
 */
import { z } from 'zod';

// ─── Tile status ──────────────────────────────────────────────────────────────

export const TileStatusSchema = z.enum(['on-track', 'at-risk', 'breach']);
export type TileStatus = z.infer<typeof TileStatusSchema>;

// ─── Per-tile shape ───────────────────────────────────────────────────────────

export const TileDataSchema = z.object({
  value:     z.number().nullable(),
  delta:     z.number().nullable(),
  sparkline: z.array(z.number()),
  target:    z.number(),
  status:    TileStatusSchema,
});
export type TileData = z.infer<typeof TileDataSchema>;

export const AiConfTileDataSchema = TileDataSchema.extend({
  threshold: z.number(),
});
export type AiConfTileData = z.infer<typeof AiConfTileDataSchema>;

// ─── Chart shapes ─────────────────────────────────────────────────────────────

export const ThroughputRowSchema = z.object({
  day:        z.string(),
  completed:  z.number().int(),
  sla_breach: z.number().int(),
});
export type ThroughputRow = z.infer<typeof ThroughputRowSchema>;

export const FunnelStageSchema = z.object({
  stage: z.string(),
  count: z.number().int(),
});
export type FunnelStage = z.infer<typeof FunnelStageSchema>;

export const HeatmapCellSchema = z.object({
  branch:   z.string(),
  doc_type: z.string(),
  cnt:      z.number().int(),
});
export type HeatmapCell = z.infer<typeof HeatmapCellSchema>;

export const ConfidenceHistogramSchema = z.object({
  lt40:    z.number().int(),
  c40to70: z.number().int(),
  c70to90: z.number().int(),
  gte90:   z.number().int(),
});
export type ConfidenceHistogram = z.infer<typeof ConfidenceHistogramSchema>;

// ─── Full KPIs response ───────────────────────────────────────────────────────

export const KpisResponseSchema = z.object({
  timeframe:  z.string(),
  comparator: z.string(),
  tiles: z.object({
    kyc_cycle:          TileDataSchema,
    percent_automated:  TileDataSchema,
    ai_confidence:      AiConfTileDataSchema,
    expiring_30d:       TileDataSchema,
    audit_failures_ytd: TileDataSchema,
  }),
  throughput:             z.array(ThroughputRowSchema),
  funnel:                 z.array(FunnelStageSchema),
  heatmap:                z.array(HeatmapCellSchema),
  confidence_histogram:   ConfidenceHistogramSchema,
});
export type KpisResponse = z.infer<typeof KpisResponseSchema>;

// ─── Timeframe / Comparator option types ─────────────────────────────────────

export const TIMEFRAMES = ['1d', '7d', '30d', '90d', 'ytd'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const COMPARATORS = ['prior_period', 'prior_year', 'target', 'none'] as const;
export type Comparator = (typeof COMPARATORS)[number];

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '1d':  'Today',
  '7d':  '7 days',
  '30d': '30 days',
  '90d': '90 days',
  'ytd': 'Year to date',
};

export const COMPARATOR_LABELS: Record<Comparator, string> = {
  prior_period: 'vs prior period',
  prior_year:   'vs last year',
  target:       'vs target',
  none:         'No comparison',
};

// ─── Tile catalog types (for customize drawer) ────────────────────────────────

export const TILE_IDS = [
  'kyc_cycle',
  'percent_automated',
  'ai_confidence',
  'expiring_30d',
  'audit_failures_ytd',
] as const;
export type TileId = (typeof TILE_IDS)[number];

export const TILE_LABELS: Record<TileId, string> = {
  kyc_cycle:          'KYC cycle time p50',
  percent_automated:  '% Automated',
  ai_confidence:      'AI confidence',
  expiring_30d:       'Expiring 30d',
  audit_failures_ytd: 'Audit failures YTD',
};

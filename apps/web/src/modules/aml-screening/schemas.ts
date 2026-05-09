import { z } from 'zod';

// ── Score breakdown (v2) ───────────────────────────────────────────────────────

export const ScoreBreakdown = z.object({
  name:    z.number().min(0).max(1),
  dob:     z.number().min(0).max(1),
  country: z.number().min(0).max(1),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdown>;

// ── Watchlist ─────────────────────────────────────────────────────────────────

export const Watchlist = z.object({
  id: z.number().int().positive(),
  list_name: z.string(),
  match_threshold: z.number().min(0).max(1),
  last_updated: z.string().nullable(),
  entry_count: z.number().int().nonnegative(),
  active: z.boolean(),
});
export type Watchlist = z.infer<typeof Watchlist>;

export const WatchlistsResponseSchema = z.array(Watchlist);

// ── Screening ─────────────────────────────────────────────────────────────────

export const Screening = z.object({
  id: z.number().int().positive(),
  customer_cid: z.string(),
  status: z.enum(['pending', 'running', 'cleared', 'flagged', 'error']),
  hit_count: z.number().int().nonnegative(),
  trigger_reason: z.string().nullable(),
  screened_at: z.string(),
  completed_at: z.string().nullable(),
});
export type Screening = z.infer<typeof Screening>;

export const ScreeningsResponseSchema = z.object({
  items: z.array(Screening),
  total: z.number().int().nonnegative(),
  next_cursor: z.string().nullable(),
});
export type ScreeningsResponse = z.infer<typeof ScreeningsResponseSchema>;

// ── Hit v2 — extended with score_breakdown and subject/watchlist PII fields ───

export const Hit = z.object({
  id: z.number().int().positive(),
  screening_id: z.number().int().positive(),
  watchlist_entry_id: z.number().int().positive().nullable(),
  watchlist_entry_name: z.string(),
  watchlist_name: z.string().nullable(),
  matched_name: z.string().nullable(),
  watchlist_dob: z.string().nullable(),
  watchlist_country: z.string().nullable(),
  original_record: z.record(z.unknown()).optional(),
  subject_name: z.string().nullable().optional(),
  subject_dob: z.string().nullable().optional(),
  subject_country: z.string().nullable().optional(),
  score: z.number().min(0).max(1),
  // score_breakdown is optional — older backends may not send it.
  // SPA defaults gracefully to { name: score, dob: 0, country: 0 }.
  score_breakdown: ScoreBreakdown.optional(),
  decision: z.enum(['open', 'cleared', 'escalated', 'blocked', 'edd']),
  reviewed_by: z.union([z.string(), z.number()]).nullable(),
  reviewed_at: z.string().nullable(),
  review_notes: z.string().nullable(),
  created_at: z.string(),
});
export type Hit = z.infer<typeof Hit>;

export const HitsResponseSchema = z.object({
  items: z.array(Hit),
  total: z.number().int().nonnegative(),
  next_cursor: z.string().nullable(),
});
export type HitsResponse = z.infer<typeof HitsResponseSchema>;

// ── AML Summary ───────────────────────────────────────────────────────────────

export const AmlSummary = z.object({
  last_24h: z.object({
    screenings_count: z.number().int(),
    hit_count: z.number().int(),
    open_hit_count: z.number().int(),
  }),
  last_run_at: z.string().nullable(),
});
export type AmlSummary = z.infer<typeof AmlSummary>;

// ── Decide request/response ───────────────────────────────────────────────────

export const DecisionEnum = z.enum(['cleared', 'escalated', 'blocked', 'edd']);
export type DecisionEnum = z.infer<typeof DecisionEnum>;

export const DecideResponseSchema = z.object({
  hit_id: z.number().int().positive(),
  decision: DecisionEnum,
  reviewed_by: z.union([z.string(), z.number()]).nullable(),
  reviewed_at: z.string().nullable(),
  notes: z.string().nullable(),
});
export type DecideResponse = z.infer<typeof DecideResponseSchema>;

// ── Suppression (Cleared + Suppress) ─────────────────────────────────────────

export const SuppressionResponseSchema = z.object({
  suppression_id:         z.number().int().positive(),
  subject_cid:            z.string(),
  watchlist_entry_id:     z.number().int().positive(),
  suppression_reason:     z.string(),
  suppressed_until:       z.string().nullable(),
  suppressed_by:          z.string(),
  created_at:             z.string(),
  hit_decision_updated:   z.string().optional(),
});
export type SuppressionResponse = z.infer<typeof SuppressionResponseSchema>;

// ── Decision history (for History tab) ───────────────────────────────────────

export const DecisionHistoryItem = z.object({
  hit_id:      z.number().int().positive(),
  decision:    z.string(),
  reviewed_by: z.union([z.string(), z.number()]).nullable(),
  reviewed_at: z.string().nullable(),
  notes:       z.string().nullable(),
  score:       z.number().min(0).max(1),
});
export type DecisionHistoryItem = z.infer<typeof DecisionHistoryItem>;

export const SuppressionHistoryItem = z.object({
  suppression_id:    z.number().int().positive(),
  suppression_reason: z.string(),
  suppressed_until:  z.string().nullable(),
  suppressed_by:     z.string(),
  created_at:        z.string(),
  is_active:         z.boolean(),
});
export type SuppressionHistoryItem = z.infer<typeof SuppressionHistoryItem>;

export const HitHistoryResponseSchema = z.object({
  hit_id:             z.number().int().positive(),
  subject_cid:        z.string(),
  watchlist_entry_id: z.number().int().positive(),
  decisions:          z.array(DecisionHistoryItem),
  suppressions:       z.array(SuppressionHistoryItem),
});
export type HitHistoryResponse = z.infer<typeof HitHistoryResponseSchema>;

// ── SAR submit ────────────────────────────────────────────────────────────────

export const SarSubmitResponseSchema = z.object({
  ok:     z.boolean(),
  stub:   z.boolean().optional(),
  hit_id: z.number().int().positive(),
});
export type SarSubmitResponse = z.infer<typeof SarSubmitResponseSchema>;

// ── Watchlist threshold update ────────────────────────────────────────────────

export const WatchlistPatchResponseSchema = Watchlist;

// ── Watchlist refresh ─────────────────────────────────────────────────────────

export const WatchlistRefreshResponseSchema = z.object({
  job_id: z.string(),
  status: z.string(),
  message: z.string(),
});
export type WatchlistRefreshResponse = z.infer<typeof WatchlistRefreshResponseSchema>;

// ── Screen customer ───────────────────────────────────────────────────────────

export const ScreenCustomerResponseSchema = z.object({
  screening_id: z.number().int().positive(),
  status: z.string(),
  message: z.string(),
});
export type ScreenCustomerResponse = z.infer<typeof ScreenCustomerResponseSchema>;

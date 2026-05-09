import { z } from 'zod';

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

// ── Hit ───────────────────────────────────────────────────────────────────────

export const Hit = z.object({
  id: z.number().int().positive(),
  screening_id: z.number().int().positive(),
  watchlist_entry_name: z.string(),
  watchlist_name: z.string(),
  score: z.number().min(0).max(1),
  decision: z.enum(['open', 'cleared', 'escalated', 'blocked']),
  reviewed_by: z.string().nullable(),
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

export const DecisionEnum = z.enum(['cleared', 'escalated', 'blocked']);
export type DecisionEnum = z.infer<typeof DecisionEnum>;

export const DecideResponseSchema = z.object({
  hit_id: z.number().int().positive(),
  decision: DecisionEnum,
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  notes: z.string().nullable(),
});
export type DecideResponse = z.infer<typeof DecideResponseSchema>;

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

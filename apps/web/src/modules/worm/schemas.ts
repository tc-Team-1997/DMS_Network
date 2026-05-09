import { z } from 'zod';

// ── WORM status (GET /spa/api/worm/{id}/status) ───────────────────────────────
// Note: sha256_baseline and sha256_current are returned by the backend but we
// intentionally omit them here — they are forensic data, not user-relevant, and
// must not be rendered in the UI (PII / forensic exposure risk).
// Only the boolean `tampered` is surfaced.

export const WormStatusSchema = z.object({
  document_id: z.number().int(),
  worm_locked: z.boolean(),
  locked_at: z.string().datetime({ offset: true }).nullable(),
  unlock_after: z.string().datetime({ offset: true }).nullable(),
  tampered: z.boolean(),
  os_flag_set: z.boolean(),
});
export type WormStatus = z.infer<typeof WormStatusSchema>;

// ── Retention period presets ───────────────────────────────────────────────────

export const RetentionPeriodSchema = z.enum([
  '30_days',
  '90_days',
  '1_year',
  '7_years',
  'indefinite',
]);
export type RetentionPeriod = z.infer<typeof RetentionPeriodSchema>;

/** Maps a preset to `unlock_after_days` sent in the lock request body.
 *  Indefinite uses a sentinel value of 36500 days (100 years) — the backend
 *  interprets a very large value as "indefinite" per the Python service contract.
 */
export const RETENTION_DAYS: Record<RetentionPeriod, number> = {
  '30_days':    30,
  '90_days':    90,
  '1_year':     365,
  '7_years':    2555,
  'indefinite': 36500,
};

// ── Lock response (POST /spa/api/worm/{id}/lock) ──────────────────────────────

export const WormLockResponseSchema = z.object({
  document_id: z.number().int(),
  locked_at: z.string().datetime({ offset: true }),
  unlock_after: z.string().datetime({ offset: true }),
  status: z.literal('locked'),
});
export type WormLockResponse = z.infer<typeof WormLockResponseSchema>;

// ── Unlock response (POST /spa/api/worm/{id}/unlock) ─────────────────────────

export const WormUnlockResponseSchema = z.object({
  document_id: z.number().int(),
  unlocked_at: z.string().datetime({ offset: true }),
  unlock_reason: z.string(),
  status: z.literal('unlocked'),
});
export type WormUnlockResponse = z.infer<typeof WormUnlockResponseSchema>;

// ── Lock request body ─────────────────────────────────────────────────────────

export const WormLockRequestSchema = z.object({
  unlock_after_days: z.number().int().positive(),
  reason: z.literal('retention_policy_applied'),
});
export type WormLockRequest = z.infer<typeof WormLockRequestSchema>;

// ── Unlock request body ───────────────────────────────────────────────────────

export const UnlockReasonSchema = z.enum([
  'legal_hold_released',
  'retention_expired',
  'error_correction',
]);
export type UnlockReason = z.infer<typeof UnlockReasonSchema>;

export const WormUnlockRequestSchema = z.object({
  reason: UnlockReasonSchema,
  approver_notes: z.string().min(10),
});
export type WormUnlockRequest = z.infer<typeof WormUnlockRequestSchema>;

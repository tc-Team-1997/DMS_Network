/**
 * Zod schemas for the Retention + WORM admin module (Wave B F#30-31).
 *
 * Covers all eight new SPA endpoints:
 *   GET  /spa/api/admin/retention/rules
 *   PUT  /spa/api/admin/retention/rules/:doctype
 *   GET  /spa/api/admin/retention/sweep-status
 *   GET  /spa/api/admin/retention/purge-log
 *   GET  /spa/api/admin/legal-holds
 *   POST /spa/api/admin/legal-holds
 *   DEL  /spa/api/admin/legal-holds/:id
 *   GET  /spa/api/admin/worm/locked
 *   POST /spa/api/admin/worm/extend
 */
import { z } from 'zod';

// ── Shared ────────────────────────────────────────────────────────────────────

export const DeletePolicySchema = z.enum(['archive', 'cryptoshred', 'soft_delete']);
export type DeletePolicy = z.infer<typeof DeletePolicySchema>;

// ── Per-doctype retention rule ─────────────────────────────────────────────────

export const RetentionRuleSchema = z.object({
  doctype:               z.string(),
  retention_period_days: z.number().int().positive(),
  worm_lock_period_days: z.number().int().positive().nullable(),
  legal_hold_eligible:   z.boolean(),
  delete_policy:         DeletePolicySchema,
});
export type RetentionRule = z.infer<typeof RetentionRuleSchema>;

export const RetentionRulesResponseSchema = z.object({
  rules: z.array(RetentionRuleSchema),
});

export const RetentionRuleInputSchema = z.object({
  retention_period_days: z.number().int().min(1),
  worm_lock_period_days: z.number().int().min(1).nullable().optional(),
  legal_hold_eligible:   z.boolean().optional(),
  delete_policy:         DeletePolicySchema.optional(),
  reason:                z.string().min(20, 'reason must be at least 20 characters'),
});
export type RetentionRuleInput = z.infer<typeof RetentionRuleInputSchema>;

// ── Sweep status ──────────────────────────────────────────────────────────────

export const SweepStatusSchema = z.object({
  last_sweep_at:         z.string().nullable(),
  purged_today:          z.number().int(),
  purged_week:           z.number().int(),
  purged_month:          z.number().int(),
  blocked_by_legal_hold: z.number().int(),
});
export type SweepStatus = z.infer<typeof SweepStatusSchema>;

// ── Purge log ─────────────────────────────────────────────────────────────────

export const PurgeLogRowSchema = z.object({
  id:         z.number().int(),
  action:     z.string().nullable(),
  entity:     z.string().nullable(),
  entity_id:  z.number().int().nullable(),
  details:    z.string().nullable(),
  created_at: z.string(),
  username:   z.string().nullable(),
});
export type PurgeLogRow = z.infer<typeof PurgeLogRowSchema>;

export const PurgeLogResponseSchema = z.object({
  rows: z.array(PurgeLogRowSchema),
});

// ── Legal holds ───────────────────────────────────────────────────────────────

export const LegalHoldSchema = z.object({
  id:            z.number().int(),
  doc_id:        z.number().int(),
  applied_by:    z.string(),
  applied_at:    z.string(),
  released_by:   z.string().nullable(),
  released_at:   z.string().nullable(),
  reason:        z.string(),
  tenant_id:     z.string(),
  document_name: z.string().nullable().optional(),
  doc_type:      z.string().nullable().optional(),
});
export type LegalHold = z.infer<typeof LegalHoldSchema>;

export const LegalHoldsListSchema = z.object({
  legal_holds: z.array(LegalHoldSchema),
  total:       z.number().int(),
});

export const ApplyHoldInputSchema = z.object({
  doc_id: z.number().int().positive(),
  reason: z.string().min(20, 'reason must be at least 20 characters'),
});
export type ApplyHoldInput = z.infer<typeof ApplyHoldInputSchema>;

export const ReleaseHoldInputSchema = z.object({
  reason: z.string().min(20, 'reason must be at least 20 characters'),
});
export type ReleaseHoldInput = z.infer<typeof ReleaseHoldInputSchema>;

// ── WORM locked documents list ─────────────────────────────────────────────────

export const LockedDocumentSchema = z.object({
  id:                z.number().int(),
  original_name:     z.string().nullable(),
  doc_type:          z.string().nullable(),
  worm_locked_at:    z.string().nullable(),
  worm_unlock_after: z.string().nullable(),
  days_remaining:    z.number().int().nullable(),
  sha256_prefix:     z.string().nullable(),
});
export type LockedDocument = z.infer<typeof LockedDocumentSchema>;

export const LockedDocumentsResponseSchema = z.object({
  locked_documents: z.array(LockedDocumentSchema),
  total:            z.number().int(),
});

// ── WORM extend ───────────────────────────────────────────────────────────────

export const ExtendLockInputSchema = z.object({
  document_id:    z.number().int().positive(),
  extend_by_days: z.number().int().min(1),
  reason:         z.string().min(20, 'reason must be at least 20 characters'),
});
export type ExtendLockInput = z.infer<typeof ExtendLockInputSchema>;

export const ExtendLockResponseSchema = z.object({
  document_id:           z.number().int(),
  previous_unlock_after: z.string().nullable(),
  new_unlock_after:      z.string(),
  extended_by_days:      z.number().int(),
  extended_at:           z.string(),
  status:                z.string(),
});
export type ExtendLockResponse = z.infer<typeof ExtendLockResponseSchema>;

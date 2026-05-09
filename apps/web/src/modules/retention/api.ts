/**
 * API layer for Retention + WORM admin (Wave B F#30-31).
 * All requests go through src/lib/http.ts with zod schemas.
 */
import { get, post, put, del } from '@/lib/http';
import {
  RetentionRulesResponseSchema,
  RetentionRuleSchema,
  RetentionRuleInputSchema,
  SweepStatusSchema,
  PurgeLogResponseSchema,
  LegalHoldsListSchema,
  LegalHoldSchema,
  ApplyHoldInputSchema,
  ReleaseHoldInputSchema,
  LockedDocumentsResponseSchema,
  ExtendLockInputSchema,
  ExtendLockResponseSchema,
  type RetentionRule,
  type RetentionRuleInput,
  type LegalHold,
  type ApplyHoldInput,
  type ReleaseHoldInput,
  type ExtendLockInput,
} from './schemas';

// ── Retention rules ────────────────────────────────────────────────────────────

export function fetchRetentionRules(): Promise<RetentionRule[]> {
  return get('/spa/api/admin/retention/rules', RetentionRulesResponseSchema).then(
    (r) => r.rules,
  );
}

export function updateRetentionRule(
  doctype: string,
  input: RetentionRuleInput,
): Promise<RetentionRule> {
  const parsed = RetentionRuleInputSchema.parse(input);
  return put(
    `/spa/api/admin/retention/rules/${encodeURIComponent(doctype)}`,
    parsed,
    RetentionRuleSchema,
  );
}

// ── Sweep status ──────────────────────────────────────────────────────────────

export function fetchSweepStatus() {
  return get('/spa/api/admin/retention/sweep-status', SweepStatusSchema);
}

// ── Purge log ─────────────────────────────────────────────────────────────────

export function fetchPurgeLog(limit = 200) {
  return get('/spa/api/admin/retention/purge-log', PurgeLogResponseSchema, { limit }).then(
    (r) => r.rows,
  );
}

// ── Legal holds ───────────────────────────────────────────────────────────────

export function fetchLegalHolds(opts: {
  active_only?: boolean;
  doc_id?: number;
  limit?: number;
} = {}) {
  return get('/spa/api/admin/legal-holds', LegalHoldsListSchema, {
    ...(opts.active_only !== undefined ? { active_only: String(opts.active_only) } : {}),
    ...(opts.doc_id !== undefined ? { doc_id: opts.doc_id } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  }).then((r) => r.legal_holds);
}

export function applyLegalHold(input: ApplyHoldInput): Promise<LegalHold> {
  const parsed = ApplyHoldInputSchema.parse(input);
  return post('/spa/api/admin/legal-holds', parsed, LegalHoldSchema);
}

export function releaseLegalHold(
  holdId: number,
  input: ReleaseHoldInput,
): Promise<LegalHold> {
  const parsed = ReleaseHoldInputSchema.parse(input);
  return del(`/spa/api/admin/legal-holds/${holdId}`, LegalHoldSchema, parsed);
}

// ── WORM admin ────────────────────────────────────────────────────────────────

export function fetchLockedDocuments(limit = 200) {
  return get('/spa/api/admin/worm/locked', LockedDocumentsResponseSchema, { limit }).then(
    (r) => r.locked_documents,
  );
}

export function extendWormLock(input: ExtendLockInput) {
  const parsed = ExtendLockInputSchema.parse(input);
  return post('/spa/api/admin/worm/extend', parsed, ExtendLockResponseSchema);
}

import { get, post } from '@/lib/http';
import {
  WormStatusSchema,
  WormLockResponseSchema,
  WormUnlockResponseSchema,
  RETENTION_DAYS,
  type RetentionPeriod,
  type UnlockReason,
} from './schemas';

// ── Feature flag ──────────────────────────────────────────────────────────────

export const FF_WORM: boolean =
  import.meta.env['VITE_FF_WORM'] !== undefined
    ? import.meta.env['VITE_FF_WORM'] !== 'false'
    : false;

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * GET /spa/api/worm/{id}/status
 * Returns lock state for a single document. Requires viewer role or above.
 */
export function fetchWormStatus(documentId: number) {
  return get(`/spa/api/worm/${documentId}/status`, WormStatusSchema);
}

// ── Write (Doc Admin only) ────────────────────────────────────────────────────

/**
 * POST /spa/api/worm/{id}/lock
 * Manually lock a document. Admin only.
 */
export function lockDocument(documentId: number, period: RetentionPeriod) {
  return post(
    `/spa/api/worm/${documentId}/lock`,
    {
      unlock_after_days: RETENTION_DAYS[period],
      reason: 'retention_policy_applied',
    },
    WormLockResponseSchema,
  );
}

/**
 * POST /spa/api/worm/{id}/unlock
 * Unlock a document. Requires reason (min 10 chars) and audit context.
 * Admin only.
 */
export function unlockDocument(
  documentId: number,
  reason: UnlockReason,
  approverNotes: string,
) {
  return post(
    `/spa/api/worm/${documentId}/unlock`,
    {
      reason,
      approver_notes: approverNotes,
    },
    WormUnlockResponseSchema,
  );
}

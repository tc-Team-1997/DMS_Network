/**
 * audit-events.ts — fire-and-forget SPA audit emission.
 *
 * Wraps POST /spa/api/audit/events (Wave E1 Task 3 endpoint).
 * Never blocks the calling UX path; errors are console-logged only.
 *
 * Allowed action values (enforced server-side allow-list):
 *   'pii_reveal' | 'pii_mask' | 'document.preview_open'
 *   | 'export.csv_requested' | 'export.pdf_requested'
 *   | 'dsar.lookup' | 'dsar.fulfill' | 'dsar.release_hold'
 *   | 'regulator.report_export' | 'regulator.report_submit'
 *   | 'audit.chain_verify'
 */

import { post } from './http';
import { z } from 'zod';

// ── Zod schemas ───────────────────────────────────────────────────────────────

const AuditEventBodySchema = z.object({
  action:      z.string().min(1).max(64),
  entity_type: z.string().min(1).max(64).optional(),
  entity_id:   z.string().min(1).max(128).optional(),
  detail:      z.record(z.unknown()).optional(),
});

export type AuditEvent = z.infer<typeof AuditEventBodySchema>;

const AuditEventRespSchema = z.object({ ok: z.literal(true) });

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Emit an audit event to /spa/api/audit/events.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export function emitAuditEvent(ev: AuditEvent): void {
  void (async () => {
    try {
      await post('/spa/api/audit/events', AuditEventBodySchema.parse(ev), AuditEventRespSchema);
    } catch (e) {
      console.error('[audit] emit failed', e);
    }
  })();
}

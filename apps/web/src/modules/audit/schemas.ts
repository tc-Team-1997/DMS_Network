/**
 * Zod schemas for the Audit Log v2 SPA API.
 * Every response from /spa/api/audit/* is validated here before use.
 *
 * Wire contract: routes/spa-api/audit.js (Wave C, migration 0038).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

export const AuditEventSchema = z.object({
  id:          z.number(),
  action:      z.string().nullable(),
  entity:      z.string().nullable(),
  entity_type: z.string().nullable(),
  entity_id:   z.number().nullable(),
  detail:      z.string().nullable(),
  details:     z.string().nullable(),
  result:      z.string().nullable(),
  prev_hash:   z.string().nullable(),
  hash:        z.string().nullable(),
  // Plan 3 (Wave-E1) — OPA decision JSON blob (stringified). Nullish so legacy
  // rows from before commit 9935b77 still parse.
  policy_decision: z.string().nullish(),
  tenant_id:   z.string().nullable(),
  created_at:  z.string().nullable(),
  username:    z.string().nullable(),
  full_name:   z.string().nullable(),
  snippet_detail: z.string().nullish(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ---------------------------------------------------------------------------
// GET /spa/api/audit/events
// ---------------------------------------------------------------------------

export const EventsResponseSchema = z.object({
  total:    z.number(),
  page:     z.number(),
  per_page: z.number(),
  events:   z.array(AuditEventSchema),
});
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

// ---------------------------------------------------------------------------
// GET /spa/api/audit/search
// ---------------------------------------------------------------------------

export const SearchResponseSchema = z.object({
  total:    z.number(),
  page:     z.number(),
  per_page: z.number(),
  query:    z.string(),
  events:   z.array(AuditEventSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ---------------------------------------------------------------------------
// GET /spa/api/audit/pivot
// ---------------------------------------------------------------------------

export const PivotRowSchema = z.object({
  pivot_key:   z.union([z.string(), z.number()]).nullable(),
  event_count: z.number(),
  first_event: z.string().nullable(),
  last_event:  z.string().nullable(),
  actions:     z.string().nullable(),
});
export type PivotRow = z.infer<typeof PivotRowSchema>;

export const PivotResponseSchema = z.object({
  by:   z.string(),
  rows: z.array(PivotRowSchema),
});
export type PivotResponse = z.infer<typeof PivotResponseSchema>;

// ---------------------------------------------------------------------------
// POST /spa/api/audit/verify-chain
// ---------------------------------------------------------------------------

export const MismatchedRowSchema = z.object({
  id:       z.number(),
  expected: z.string(),
  stored:   z.string(),
});

export const VerifyChainResponseSchema = z.object({
  verified:        z.boolean(),
  checked:         z.number(),
  mismatched_rows: z.array(MismatchedRowSchema),
  head_hash:       z.string().nullable(),
});
export type VerifyChainResponse = z.infer<typeof VerifyChainResponseSchema>;

// ---------------------------------------------------------------------------
// POST /spa/api/audit/anchor
// ---------------------------------------------------------------------------

export const AnchorResponseSchema = z.object({
  anchored:   z.boolean(),
  head_hash:  z.string().nullable(),
  block_hash: z.string().nullable(),
  ts:         z.string().nullable(),
  record:     z.record(z.unknown()).nullable(),
});
export type AnchorResponse = z.infer<typeof AnchorResponseSchema>;

// ---------------------------------------------------------------------------
// Plan 3 (Wave-E1) — Task #4 schemas
// ---------------------------------------------------------------------------

// GET /spa/api/audit/chain/verify — full walk from genesis.
export const ChainVerifyV2ResponseSchema = z.object({
  verified:      z.boolean(),
  count:         z.number(),
  latest_anchor: z.string().nullable(),
  broken_at:     z.number().nullable(),
});
export type ChainVerifyV2Response = z.infer<typeof ChainVerifyV2ResponseSchema>;

// GET /spa/api/audit/events/:id/with-context — payload for DiffDrawer.
export const EventWithContextSchema = z.object({
  event: z.object({
    id:              z.number(),
    action:          z.string().nullable(),
    entity:          z.string().nullable(),
    entity_type:     z.string().nullable(),
    entity_id:       z.number().nullable(),
    detail:          z.unknown(),
    policy_decision: z.unknown().nullable(),
    result:          z.string().nullable(),
    prev_hash:       z.string().nullable(),
    hash:            z.string().nullable(),
    tenant_id:       z.string().nullable(),
    user_id:         z.number().nullable(),
    created_at:      z.string().nullable(),
    username:        z.string().nullable(),
    full_name:       z.string().nullable(),
  }),
  chain: z.object({
    prev: z.object({ id: z.number(), hash: z.string().nullable() }).nullable(),
    this: z.object({
      id:        z.number(),
      prev_hash: z.string().nullable(),
      hash:      z.string().nullable(),
    }),
    next: z.object({ id: z.number(), hash: z.string().nullable() }).nullable(),
  }),
});
export type EventWithContext = z.infer<typeof EventWithContextSchema>;

// ---------------------------------------------------------------------------
// Filter params (shared between events + export)
// ---------------------------------------------------------------------------

export type EntityTypeFilter =
  | 'document' | 'customer' | 'workflow' | 'user' | 'config' | 'system' | '';

export type ResultFilter = 'allow' | 'deny' | 'error' | '';

export type PivotBy = 'document_id' | 'customer_cid' | 'user_id' | 'entity_type';

export interface AuditFilters {
  entity_type?: EntityTypeFilter;
  action?:      string;
  actor?:       string;
  from?:        string;
  to?:          string;
  result?:      ResultFilter;
  page?:        number;
  per_page?:    number;
}

/**
 * CBS (Temenos T24) Zod schemas.
 *
 * These types are the browser-side view of the Node SPA mirror at
 * /spa/api/cbs/*. The `raw` field is stripped server-side and must NEVER
 * appear here. No monetary amounts — the contract explicitly excludes balances.
 */

import { z } from 'zod';

// ── Health ─────────────────────────────────────────────────────────────────

export const CbsHealth = z.object({
  ok: z.boolean(),
  circuit_state: z.enum(['closed', 'open', 'half_open']),
  cache_hit_rate: z.number().min(0).max(1),
  last_check: z.string(),
});
export type CbsHealth = z.infer<typeof CbsHealth>;

// ── Customer master ────────────────────────────────────────────────────────

export const CbsCustomer = z.object({
  cif: z.string(),
  name: z.string(),
  national_id: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  risk_band: z.enum(['low', 'medium', 'high']).nullable(),
  kyc_status: z.string().nullable(),
  cached: z.boolean().default(false),
  stale: z.boolean().default(false),
  // present when stale=true — ISO datetime from server
  cached_at: z.string().optional(),
});
export type CbsCustomer = z.infer<typeof CbsCustomer>;

// ── Account record ─────────────────────────────────────────────────────────
// No balance field — DMS must never expose monetary amounts to the browser.

export const CbsAccount = z.object({
  account_id: z.string(),
  account_type: z.string(),
  status: z.string(),
});
export type CbsAccount = z.infer<typeof CbsAccount>;

export const CbsAccountsResponse = z.object({
  accounts: z.array(CbsAccount),
});
export type CbsAccountsResponse = z.infer<typeof CbsAccountsResponse>;

// ── Link document ──────────────────────────────────────────────────────────

export const TransactionTypeEnum = z.enum([
  'loan_disbursement',
  'account_opening',
  'kyc_document',
  'trade_finance',
]);
export type TransactionTypeEnum = z.infer<typeof TransactionTypeEnum>;

export const CbsLinkRequest = z.object({
  document_id: z.number().int().positive(),
  transaction_ref: z.string().min(1).max(128),
  transaction_type: TransactionTypeEnum,
});
export type CbsLinkRequest = z.infer<typeof CbsLinkRequest>;

export const CbsLinkResponse = z.object({
  link_id: z.number().int().positive(),
  cif: z.string(),
  document_id: z.number().int().positive(),
  transaction_ref: z.string(),
  linked_at: z.string(),
  idempotency_key: z.string(),
});
export type CbsLinkResponse = z.infer<typeof CbsLinkResponse>;

// ── Cache invalidation ──────────────────────────────────────────────────────

export const CbsInvalidateCacheResponse = z.object({
  ok: z.boolean(),
  cif: z.string(),
});
export type CbsInvalidateCacheResponse = z.infer<typeof CbsInvalidateCacheResponse>;

// ── Error envelope (standard shape from Node SPA mirror) ──────────────────

export const CbsErrorEnvelope = z.object({
  error: z.string(),
  message: z.string().optional(),
  retry_after: z.number().optional(),
});
export type CbsErrorEnvelope = z.infer<typeof CbsErrorEnvelope>;

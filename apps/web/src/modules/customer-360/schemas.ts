/**
 * customer-360/schemas.ts
 *
 * Zod schemas for all Customer-360 API responses served by the Node SPA layer
 * (which proxies to Python /api/v1/customer360/*).
 *
 * Contract:
 *   GET  /spa/api/customer360/:cid              → Customer360Header
 *   POST /spa/api/customer360/:cid/pii-reveal   → PiiRevealResponse
 *   GET  /spa/api/customer360/:cid/accounts     → AccountsResponse
 *   GET  /spa/api/customer360/:cid/documents    → DocumentsResponse
 *   GET  /spa/api/customer360/:cid/transactions → TransactionsResponse
 *   GET  /spa/api/customer360/:cid/workflows    → WorkflowsResponse
 *   GET  /spa/api/customer360/:cid/activity     → ActivityResponse
 */

import { z } from 'zod';

// ── Header card (GET /:cid) ────────────────────────────────────────────────────

export const Customer360HeaderSchema = z.object({
  cid:             z.string(),
  full_name:       z.string(),
  national_id:     z.string().nullable(),           // masked unless revealed
  dob:             z.string().nullable(),            // masked unless revealed
  phone:           z.string().nullable(),            // masked unless revealed
  email:           z.string().nullable(),            // masked unless revealed
  branch:          z.string().nullable(),
  risk_band:       z.enum(['low', 'medium', 'high']).nullable(),
  kyc_status:      z.string().nullable(),            // e.g. 'approved', 'pending'
  aml_status:      z.string().nullable(),            // e.g. 'cleared', 'flagged'
  onboarded_date:  z.string().nullable(),
});
export type Customer360Header = z.infer<typeof Customer360HeaderSchema>;

// ── PII reveal (POST /:cid/pii-reveal) ────────────────────────────────────────

export const PiiRevealResponseSchema = z.object({
  cid:         z.string(),
  revealed:    z.record(z.string()),                 // field → unmasked value
  revealed_at: z.string(),
  expires_at:  z.string(),
});
export type PiiRevealResponse = z.infer<typeof PiiRevealResponseSchema>;

// ── Accounts (GET /:cid/accounts) ─────────────────────────────────────────────

export const AccountSchema = z.object({
  account_id:   z.string(),
  account_type: z.string().nullable(),
  currency:     z.string().nullable(),
  status:       z.string().nullable(),
  balance:      z.number().nullable(),
  opened_date:  z.string().nullable(),
});
export type Account = z.infer<typeof AccountSchema>;

export const AccountsResponseSchema = z.object({
  items: z.array(AccountSchema),
  total: z.number().int().nonnegative(),
});
export type AccountsResponse = z.infer<typeof AccountsResponseSchema>;

// ── Documents (GET /:cid/documents) ───────────────────────────────────────────

export const C360DocumentSchema = z.object({
  id:             z.number().int().positive(),
  doc_type:       z.string().nullable(),
  original_name:  z.string(),
  created_at:     z.string(),
  status:         z.string().nullable(),
});
export type C360Document = z.infer<typeof C360DocumentSchema>;

export const DocumentsResponseSchema = z.object({
  items: z.array(C360DocumentSchema),
  total: z.number().int().nonnegative(),
});
export type DocumentsResponse = z.infer<typeof DocumentsResponseSchema>;

// ── Transactions (GET /:cid/transactions) ─────────────────────────────────────

export const TransactionSchema = z.object({
  tx_ref:       z.string(),
  tx_type:      z.string().nullable(),
  amount:       z.number().nullable(),
  currency:     z.string().nullable(),
  direction:    z.enum(['credit', 'debit']).nullable(),
  tx_date:      z.string().nullable(),
  description:  z.string().nullable(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const TransactionsResponseSchema = z.object({
  items: z.array(TransactionSchema),
  total: z.number().int().nonnegative(),
});
export type TransactionsResponse = z.infer<typeof TransactionsResponseSchema>;

// ── Workflows (GET /:cid/workflows) ───────────────────────────────────────────

export const C360WorkflowSchema = z.object({
  id:           z.number().int().positive(),
  workflow_type: z.string().nullable(),
  status:       z.string().nullable(),
  created_at:   z.string(),
  updated_at:   z.string().nullable(),
});
export type C360Workflow = z.infer<typeof C360WorkflowSchema>;

export const WorkflowsResponseSchema = z.object({
  items: z.array(C360WorkflowSchema),
  total: z.number().int().nonnegative(),
});
export type WorkflowsResponse = z.infer<typeof WorkflowsResponseSchema>;

// ── Activity log (GET /:cid/activity) ─────────────────────────────────────────

export const ActivityEntrySchema = z.object({
  id:          z.number().int().positive(),
  action:      z.string(),
  actor:       z.string().nullable(),
  actor_role:  z.string().nullable(),
  details:     z.record(z.unknown()).optional(),
  created_at:  z.string(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const ActivityResponseSchema = z.object({
  items: z.array(ActivityEntrySchema),
  total: z.number().int().nonnegative(),
});
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

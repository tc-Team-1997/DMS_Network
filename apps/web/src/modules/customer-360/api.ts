/**
 * customer-360/api.ts
 *
 * All network calls for the Customer-360 drawer.
 * Every call goes through lib/http.ts with a Zod schema — no raw fetch().
 */

import { get, post } from '@/lib/http';
import {
  Customer360HeaderSchema,
  PiiRevealResponseSchema,
  AccountsResponseSchema,
  DocumentsResponseSchema,
  TransactionsResponseSchema,
  WorkflowsResponseSchema,
  ActivityResponseSchema,
  type Customer360Header,
  type PiiRevealResponse,
  type AccountsResponse,
  type DocumentsResponse,
  type TransactionsResponse,
  type WorkflowsResponse,
  type ActivityResponse,
} from './schemas';

// ── Header ────────────────────────────────────────────────────────────────────

export function fetchCustomer360Header(cid: string): Promise<Customer360Header> {
  return get(`/spa/api/customer360/${encodeURIComponent(cid)}`, Customer360HeaderSchema);
}

// ── PII reveal ────────────────────────────────────────────────────────────────

export function revealPii(
  cid: string,
  fields: string[],
  reason: string,
): Promise<PiiRevealResponse> {
  return post(
    `/spa/api/customer360/${encodeURIComponent(cid)}/pii-reveal`,
    { fields, reason },
    PiiRevealResponseSchema,
  );
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export function fetchAccounts(
  cid: string,
  params?: { limit?: number; offset?: number },
): Promise<AccountsResponse> {
  return get(
    `/spa/api/customer360/${encodeURIComponent(cid)}/accounts`,
    AccountsResponseSchema,
    {
      limit:  params?.limit  ?? 20,
      offset: params?.offset ?? 0,
    },
  );
}

// ── Documents ─────────────────────────────────────────────────────────────────

export function fetchC360Documents(
  cid: string,
  params?: { limit?: number; offset?: number },
): Promise<DocumentsResponse> {
  return get(
    `/spa/api/customer360/${encodeURIComponent(cid)}/documents`,
    DocumentsResponseSchema,
    {
      limit:  params?.limit  ?? 20,
      offset: params?.offset ?? 0,
    },
  );
}

// ── Transactions ──────────────────────────────────────────────────────────────

export function fetchTransactions(
  cid: string,
  params?: { limit?: number; offset?: number },
): Promise<TransactionsResponse> {
  return get(
    `/spa/api/customer360/${encodeURIComponent(cid)}/transactions`,
    TransactionsResponseSchema,
    {
      limit:  params?.limit  ?? 20,
      offset: params?.offset ?? 0,
    },
  );
}

// ── Workflows ─────────────────────────────────────────────────────────────────

export function fetchC360Workflows(
  cid: string,
  params?: { limit?: number; offset?: number },
): Promise<WorkflowsResponse> {
  return get(
    `/spa/api/customer360/${encodeURIComponent(cid)}/workflows`,
    WorkflowsResponseSchema,
    {
      limit:  params?.limit  ?? 20,
      offset: params?.offset ?? 0,
    },
  );
}

// ── Activity log ──────────────────────────────────────────────────────────────

export function fetchActivity(
  cid: string,
  params?: { limit?: number; offset?: number },
): Promise<ActivityResponse> {
  return get(
    `/spa/api/customer360/${encodeURIComponent(cid)}/activity`,
    ActivityResponseSchema,
    {
      limit:  params?.limit  ?? 20,
      offset: params?.offset ?? 0,
    },
  );
}

import { get, post } from '@/lib/http';
import {
  LookupResponseSchema,
  InventoryResponseSchema,
  ListRequestsResponseSchema,
  CreateRequestResponseSchema,
  FulfillReceiptSchema,
  ReleaseHoldResponseSchema,
  SlaDetailSchema,
  type LookupAxis,
  type DsarAction,
  type CreateRequestResponse,
  type FulfillReceipt,
  type ReleaseHoldResponse,
  type SlaDetail,
} from './schemas';

// ---------------------------------------------------------------------------
// Subject lookup
// ---------------------------------------------------------------------------

export const lookupSubject = (axis: LookupAxis, value: string) =>
  get('/spa/api/dsar/lookup', LookupResponseSchema, { axis, value });

// ---------------------------------------------------------------------------
// Artifact inventory
// ---------------------------------------------------------------------------

export const fetchInventory = (cid: string) =>
  get(`/spa/api/dsar/subjects/${encodeURIComponent(cid)}/inventory`, InventoryResponseSchema);

// ---------------------------------------------------------------------------
// DSAR requests
// ---------------------------------------------------------------------------

export const fetchRequests = () =>
  get('/spa/api/dsar/requests', ListRequestsResponseSchema);

export const createRequest = (body: {
  customer_cid: string;
  action: DsarAction;
  regulator?: string | null;
  reason?: string | null;
  params?: Record<string, unknown> | null;
}): Promise<CreateRequestResponse> =>
  post('/spa/api/dsar/requests', body, CreateRequestResponseSchema);

// ---------------------------------------------------------------------------
// Fulfillment actions
// ---------------------------------------------------------------------------

// Plan 3 — Wave-E1: fulfill now takes a structured body so the Article 17
// double-confirm + min-20-char reason can be enforced server-side.
export interface FulfillBody {
  kind: DsarAction;
  reason: string;
  destroy_token?: string;
}

export const fulfillRequest = (
  requestId: string,
  body: FulfillBody = { kind: 'article15_export', reason: 'Plan 3 fulfillment — reason placeholder' },
): Promise<FulfillReceipt> =>
  post(`/spa/api/dsar/requests/${encodeURIComponent(requestId)}/fulfill`, body, FulfillReceiptSchema);

export const releaseHold = (requestId: string): Promise<ReleaseHoldResponse> =>
  post(`/spa/api/dsar/requests/${encodeURIComponent(requestId)}/release-hold`, {}, ReleaseHoldResponseSchema);

// SLA detail for a single DSAR request (Plan 3 — Wave-E1).
export const fetchSla = (requestId: string): Promise<SlaDetail> =>
  get(`/spa/api/dsar/requests/${encodeURIComponent(requestId)}/sla`, SlaDetailSchema);

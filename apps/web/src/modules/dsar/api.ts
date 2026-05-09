import { get, post } from '@/lib/http';
import {
  LookupResponseSchema,
  InventoryResponseSchema,
  ListRequestsResponseSchema,
  CreateRequestResponseSchema,
  FulfillReceiptSchema,
  ReleaseHoldResponseSchema,
  type LookupAxis,
  type DsarAction,
  type CreateRequestResponse,
  type FulfillReceipt,
  type ReleaseHoldResponse,
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

export const fulfillRequest = (requestId: string): Promise<FulfillReceipt> =>
  post(`/spa/api/dsar/requests/${encodeURIComponent(requestId)}/fulfill`, {}, FulfillReceiptSchema);

export const releaseHold = (requestId: string): Promise<ReleaseHoldResponse> =>
  post(`/spa/api/dsar/requests/${encodeURIComponent(requestId)}/release-hold`, {}, ReleaseHoldResponseSchema);

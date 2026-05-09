import { z } from 'zod';

// ---------------------------------------------------------------------------
// Subject lookup
// ---------------------------------------------------------------------------

export const LookupAxisSchema = z.enum(['cid', 'email', 'phone', 'national_id']);
export type LookupAxis = z.infer<typeof LookupAxisSchema>;

export const SubjectMatchSchema = z.object({
  cid: z.string(),
  name: z.string().nullable(),
  tenant_id: z.string().nullable(),
  cbs_source: z.string().nullable(),
  match_axis: z.string(),
});
export type SubjectMatch = z.infer<typeof SubjectMatchSchema>;

export const LookupResponseSchema = z.object({
  matches: z.array(SubjectMatchSchema),
  count: z.number().int(),
});
export type LookupResponse = z.infer<typeof LookupResponseSchema>;

// ---------------------------------------------------------------------------
// Artifact inventory (5 panels)
// ---------------------------------------------------------------------------

export const PanelCountsSchema = z.object({
  documents: z.number().int(),
  ai_traces: z.number().int(),
  audit_events: z.number().int(),
  workflows: z.number().int(),
  cbs_records: z.number().int(),
});
export type PanelCounts = z.infer<typeof PanelCountsSchema>;

export const InventoryResponseSchema = z.object({
  customer_cid: z.string(),
  panels: PanelCountsSchema,
});
export type InventoryResponse = z.infer<typeof InventoryResponseSchema>;

// ---------------------------------------------------------------------------
// DSAR request
// ---------------------------------------------------------------------------

export const DsarActionSchema = z.enum([
  'article15_export',
  'article17_cryptoshred',
  'litigation_hold',
  'fulfillment_letter',
]);
export type DsarAction = z.infer<typeof DsarActionSchema>;

export const DsarStatusSchema = z.enum(['NEW', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']);
export type DsarStatus = z.infer<typeof DsarStatusSchema>;

export const DsarRequestSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  customer_cid: z.string(),
  action: DsarActionSchema,
  status: DsarStatusSchema,
  requested_by: z.string(),
  requested_at: z.string().nullable(),
  sla_due_at: z.string().nullable(),
  days_remaining: z.number().int().nullable(),
  completed_at: z.string().nullable(),
  regulator: z.string().nullable(),
  fulfillment_artifact_path: z.string().nullable(),
  signed_receipt: z.unknown().nullable(),
});
export type DsarRequest = z.infer<typeof DsarRequestSchema>;

export const ListRequestsResponseSchema = z.object({
  items: z.array(DsarRequestSchema),
  count: z.number().int(),
});
export type ListRequestsResponse = z.infer<typeof ListRequestsResponseSchema>;

// Create request
export const CreateRequestBodySchema = z.object({
  customer_cid: z.string().min(1),
  action: DsarActionSchema,
  regulator: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  params: z.record(z.unknown()).nullable().optional(),
});
export type CreateRequestBody = z.infer<typeof CreateRequestBodySchema>;

export const CreateRequestResponseSchema = z.object({
  id: z.string(),
  status: DsarStatusSchema,
  sla_due_at: z.string().nullable(),
  action: DsarActionSchema,
  customer_cid: z.string(),
});
export type CreateRequestResponse = z.infer<typeof CreateRequestResponseSchema>;

// Fulfill / receipt
export const FulfillReceiptSchema = z.object({
  request_id: z.string(),
  action: DsarActionSchema,
  customer_cid: z.string(),
  actor: z.string(),
  completed_at: z.string(),
  regulator: z.string(),
}).and(z.record(z.unknown()));
export type FulfillReceipt = z.infer<typeof FulfillReceiptSchema>;

// Release hold
export const ReleaseHoldResponseSchema = z.object({
  request_id: z.string(),
  customer_cid: z.string(),
  released_by: z.string(),
  documents_released: z.number().int(),
});
export type ReleaseHoldResponse = z.infer<typeof ReleaseHoldResponseSchema>;

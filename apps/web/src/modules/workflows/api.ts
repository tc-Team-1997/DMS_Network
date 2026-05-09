/**
 * Workflows v2 — API layer.
 *
 * All fetches go through src/lib/http.ts with a zod schema.
 * No fetch() or untyped axios calls.
 */

import { get, post } from '@/lib/http';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const WfActionRowSchema = z.object({
  id:                    z.number().int(),
  workflow_id:           z.number().int(),
  user_id:               z.number().int(),
  action:                z.string(),
  reason_code:           z.string().nullable(),
  comment:               z.string().nullable(),
  webauthn_assertion_id: z.string().nullable(),
  attachment_id:         z.number().int().nullable(),
  tenant_id:             z.string(),
  created_at:            z.string(),
  actor_name:            z.string().nullable(),
  actor_username:        z.string().nullable(),
});
export type WfActionRow = z.infer<typeof WfActionRowSchema>;

export const WorkflowDetailSchema = z.object({
  id:              z.number().int(),
  ref_code:        z.string().nullable(),
  title:           z.string().nullable(),
  doc_id:          z.number().int().nullable(),
  stage:           z.string(),
  priority:        z.string(),
  risk_band:       z.string().nullable().optional(),
  amount:          z.number().nullable().optional(),
  tenant_id:       z.string(),
  created_at:      z.string(),
  updated_at:      z.string(),
  document_name:   z.string().nullable(),
  doc_type:        z.string().nullable(),
  customer_name:   z.string().nullable(),
  branch:          z.string().nullable(),
  document_status: z.string().nullable(),
  audit_trail:     z.array(WfActionRowSchema),
});
export type WorkflowDetail = z.infer<typeof WorkflowDetailSchema>;

export const WorkflowRowSchema = z.object({
  id:              z.number().int(),
  ref_code:        z.string().nullable(),
  title:           z.string().nullable(),
  doc_id:          z.number().int().nullable(),
  stage:           z.string(),
  priority:        z.string(),
  risk_band:       z.string().nullable().optional(),
  amount:          z.number().nullable().optional(),
  tenant_id:       z.string(),
  created_at:      z.string(),
  updated_at:      z.string(),
  document_name:   z.string().nullable(),
  doc_type:        z.string().nullable(),
  customer_name:   z.string().nullable(),
  branch:          z.string().nullable(),
  document_status: z.string().nullable(),
});
export type WorkflowRow = z.infer<typeof WorkflowRowSchema>;

export const WorkflowListResponseSchema = z.object({
  data:     z.array(WorkflowRowSchema),
  total:    z.number().int(),
  page:     z.number().int(),
  pageSize: z.number().int(),
});
export type WorkflowListResponse = z.infer<typeof WorkflowListResponseSchema>;

export const ActionResultSchema = z.object({
  ok:       z.literal(true),
  stage:    z.string(),
  workflow: WorkflowRowSchema,
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const BulkRowResultSchema = z.object({
  id:    z.number().int(),
  ok:    z.boolean(),
  stage: z.string().optional(),
  error: z.string().optional(),
});

export const BulkResultSchema = z.object({
  ok:      z.literal(true),
  results: z.array(BulkRowResultSchema),
});
export type BulkResult = z.infer<typeof BulkResultSchema>;

// ---------------------------------------------------------------------------
// Filter params
// ---------------------------------------------------------------------------

export interface WorkflowFilters {
  tab?:       string;
  search?:    string;
  branch?:    string;
  doc_type?:  string;
  risk_band?: string;
  page?:      number;
  pageSize?:  number;
}

// ---------------------------------------------------------------------------
// Action payloads
// ---------------------------------------------------------------------------

export interface ApprovePayload {
  reason_code:             string;
  comment:                 string;
  webauthn_assertion_id?:  string;
}

export interface RejectPayload {
  reason_code:             string;
  comment:                 string;
  attachment_id?:          number;
  webauthn_assertion_id?:  string;
}

export interface EscalatePayload {
  reason_code:             string;
  comment:                 string;
  target:                  string;
  webauthn_assertion_id?:  string;
}

export type WorkflowActionKind = 'approve' | 'reject' | 'escalate';
/** Backward-compat alias. */
export type WorkflowAction = WorkflowActionKind;

export interface BulkPayload {
  ids:                     number[];
  action:                  WorkflowActionKind;
  reason_code:             string;
  comment:                 string;
  target?:                 string;
  attachment_id?:          number;
  webauthn_assertion_id?:  string;
}

// ---------------------------------------------------------------------------
// Python step-up dance (proxy via /py)
// ---------------------------------------------------------------------------

const StepUpStartSchema = z
  .object({
    challenge:        z.string(),
    rpId:             z.string().optional(),
    timeout:          z.number().optional(),
    userVerification: z.string().optional(),
    allowCredentials: z.array(z.unknown()).optional(),
  })
  .passthrough();

const StepUpFinishSchema = z
  .object({ assertion_id: z.string() })
  .passthrough();

export async function stepUpStart(
  action: string,
  resourceId?: number,
): Promise<z.infer<typeof StepUpStartSchema>> {
  return post(
    '/py/api/v1/stepup/authenticate/start',
    { action, resource_id: resourceId ?? null },
    StepUpStartSchema,
  );
}

export async function stepUpFinish(
  action: string,
  credential: unknown,
  resourceId?: number,
): Promise<string> {
  const result = await post(
    '/py/api/v1/stepup/authenticate/finish',
    { action, resource_id: resourceId ?? null, credential },
    StepUpFinishSchema,
  );
  return result.assertion_id;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export const fetchWorkflows = (filters: WorkflowFilters = {}): Promise<WorkflowListResponse> =>
  get('/spa/api/workflows', WorkflowListResponseSchema, filters as Record<string, unknown>);

export const fetchWorkflow = (id: number): Promise<WorkflowDetail> =>
  get(`/spa/api/workflows/${id}`, WorkflowDetailSchema);

export const approveWorkflow = (id: number, payload: ApprovePayload): Promise<ActionResult> =>
  post(`/spa/api/workflows/${id}/approve`, payload, ActionResultSchema);

export const rejectWorkflow = (id: number, payload: RejectPayload): Promise<ActionResult> =>
  post(`/spa/api/workflows/${id}/reject`, payload, ActionResultSchema);

export const escalateWorkflow = (id: number, payload: EscalatePayload): Promise<ActionResult> =>
  post(`/spa/api/workflows/${id}/escalate`, payload, ActionResultSchema);

export const bulkAction = (payload: BulkPayload): Promise<BulkResult> =>
  post('/spa/api/workflows/bulk', payload, BulkResultSchema);

// Legacy single-endpoint kept for any callers still using v1 api.ts shape.
const LegacyActionResultSchema = z
  .object({ ok: z.literal(true), stage: z.string() })
  .passthrough();

export const actOnWorkflow = (id: number, action: WorkflowAction): Promise<z.infer<typeof LegacyActionResultSchema>> =>
  post(`/spa/api/workflows/${id}/actions`, { action }, LegacyActionResultSchema);

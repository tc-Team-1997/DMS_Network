import { z } from 'zod';
import { get } from '@/lib/http';

export const ComplianceSummarySchema = z.object({
  expiry: z.object({
    d30: z.number().int(),
    d60: z.number().int(),
    d90: z.number().int(),
    overdue: z.number().int(),
  }),
  retention: z.array(z.object({
    doc_type: z.string().nullable(),
    retention_years: z.number().int(),
    auto_purge: z.number().int(),
    doc_count: z.number().int(),
  })),
  workflow_sla: z.object({
    late: z.number().int().nullable(),
    on_track: z.number().int().nullable(),
    approved: z.number().int().nullable(),
    rejected: z.number().int().nullable(),
  }),
  audit: z.array(z.object({
    id: z.number().int(),
    action: z.string().nullable(),
    entity: z.string().nullable(),
    entity_id: z.number().int().nullable(),
    created_at: z.string(),
    username: z.string().nullable(),
  })),
});
export type ComplianceSummary = z.infer<typeof ComplianceSummarySchema>;

export const fetchComplianceSummary = () =>
  get('/spa/api/compliance/summary', ComplianceSummarySchema);

// ---------------------------------------------------------------------------
// Regulatory controls — GET /spa/api/compliance/controls
// Status is derived from real data server-side; shape mirrors the Control
// interface in CompliancePage.tsx so no UI reshape is needed.
// ---------------------------------------------------------------------------
export const ControlSchema = z.object({
  id:        z.string(),
  name:      z.string(),
  framework: z.string(),
  status:    z.enum(['pass', 'warn', 'fail']),
  evidence:  z.string(),
  lastAudit: z.string(),
});
export type Control = z.infer<typeof ControlSchema>;

export const ControlsResponseSchema = z.array(ControlSchema);

export const fetchComplianceControls = () =>
  get('/spa/api/compliance/controls', ControlsResponseSchema);

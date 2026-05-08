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

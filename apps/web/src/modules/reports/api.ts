import { z } from 'zod';
import { get } from '@/lib/http';

export const ReportSummarySchema = z.object({
  totals: z.object({
    all: z.number().int(),
    valid: z.number().int(),
    expiring: z.number().int(),
    expired: z.number().int(),
  }),
  monthly: z.array(z.object({ month: z.string(), count: z.number().int() })),
  by_branch: z.array(z.object({ branch: z.string(), count: z.number().int() })),
  by_type: z.array(z.object({ doc_type: z.string(), count: z.number().int() })),
  expiry: z.object({
    d30: z.number().int(),
    d60: z.number().int(),
    d90: z.number().int(),
  }),
  workflows: z.object({
    pending: z.number().int(),
    approved: z.number().int(),
    rejected: z.number().int(),
  }),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const fetchReportSummary = () =>
  get('/spa/api/reports/summary', ReportSummarySchema);

export const EXPORT_CSV_URL = '/spa/api/reports/export.csv';

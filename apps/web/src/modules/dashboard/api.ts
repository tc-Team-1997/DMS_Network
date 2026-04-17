import { get } from '@/lib/http';
import { AlertSchema, StatsSchema, WorkflowSchema } from '@/lib/schemas';
import { z } from 'zod';

export const fetchStats = () => get('/spa/api/stats', StatsSchema);

export const fetchRecentWorkflows = () =>
  get('/spa/api/workflows', z.array(WorkflowSchema), { limit: 5 });

export const fetchRecentAlerts = () =>
  get('/spa/api/alerts', z.array(AlertSchema), { limit: 5 });

export const ExpiryBucketsSchema = z.object({
  labels: z.array(z.string()),
  counts: z.array(z.number().int()),
});
export type ExpiryBuckets = z.infer<typeof ExpiryBucketsSchema>;
export const fetchExpiryBuckets = () => get('/spa/api/stats/expiry', ExpiryBucketsSchema);

export const DocTypeBreakdownSchema = z.array(
  z.object({ doc_type: z.string(), count: z.number().int() }),
);
export const fetchDocTypeBreakdown = () =>
  get('/spa/api/stats/doc-types', DocTypeBreakdownSchema);

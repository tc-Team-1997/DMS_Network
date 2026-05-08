import { z } from 'zod';
import { get, http } from '@/lib/http';
import { OkSchema } from '@/lib/schemas';

// Indexing candidates carry only the subset of columns a triage UI needs.
export const IndexingRowSchema = z.object({
  id: z.number().int(),
  filename: z.string(),
  original_name: z.string().nullable(),
  doc_type: z.string().nullable(),
  customer_cid: z.string().nullable(),
  customer_name: z.string().nullable(),
  doc_number: z.string().nullable(),
  dob: z.string().nullable(),
  issue_date: z.string().nullable(),
  expiry_date: z.string().nullable(),
  issuing_authority: z.string().nullable(),
  branch: z.string().nullable(),
  status: z.string(),
  ocr_confidence: z.number().nullable(),
  uploaded_at: z.string(),
  notes: z.string().nullable(),
});
export type IndexingRow = z.infer<typeof IndexingRowSchema>;

export const IndexingStatsSchema = z.object({
  low_confidence: z.number().int(),
  missing_type: z.number().int(),
  missing_owner: z.number().int(),
  missing_number: z.number().int(),
});
export type IndexingStats = z.infer<typeof IndexingStatsSchema>;

export const IndexingPatchSchema = z.object({
  doc_type: z.string().nullable().optional(),
  customer_cid: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  doc_number: z.string().nullable().optional(),
  dob: z.string().nullable().optional(),
  issue_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  issuing_authority: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type IndexingPatch = z.infer<typeof IndexingPatchSchema>;

export interface IndexingFilters {
  low_conf?: 0 | 1;
  limit?: number;
}

export const fetchIndexingQueue = (f: IndexingFilters = {}) =>
  get('/spa/api/indexing', z.array(IndexingRowSchema), f as Record<string, unknown>);

export const fetchIndexingStats = () =>
  get('/spa/api/indexing/stats', IndexingStatsSchema);

export const patchIndexingRow = async (id: number, patch: IndexingPatch) => {
  const parsed = IndexingPatchSchema.parse(patch);
  const { data } = await http.patch(`/spa/api/indexing/${id}`, parsed);
  return OkSchema.parse(data);
};

import { z } from 'zod';
import { get } from '@/lib/http';

export const AdapterStatusSchema = z.enum(['live', 'sandbox', 'mock', 'planned']);
export type AdapterStatus = z.infer<typeof AdapterStatusSchema>;

export const AdapterRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  status: AdapterStatusSchema,
  wave: z.string(),
  health: z.unknown().nullable(),
});
export type AdapterRow = z.infer<typeof AdapterRowSchema>;

export const AdapterListSchema = z.object({
  adapters: z.array(AdapterRowSchema),
  note: z.string(),
});
export type AdapterList = z.infer<typeof AdapterListSchema>;

export const fetchAdapters = () =>
  get('/spa/api/integrations', AdapterListSchema);

import { z } from 'zod';
import { del, get, post } from '@/lib/http';
import { http } from '@/lib/http';

export const GlossaryTermSchema = z.object({
  id:            z.number(),
  term:          z.string(),
  definition:    z.string(),
  synonyms:      z.array(z.string()).default([]),
  table_hint:    z.string().nullable().optional(),
  column_hint:   z.string().nullable().optional(),
  sql_template:  z.string().nullable().optional(),
  category:      z.enum(['column', 'metric', 'filter', 'entity']).default('metric'),
  source:        z.string(),
  approved:      z.boolean(),
  tenant_id:     z.string(),
  created_by:    z.number().nullable().optional(),
  created_at:    z.string(),
  updated_at:    z.string(),
});
export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;

export const GlossaryCoverageSchema = z.object({
  total:        z.number(),
  approved:     z.number(),
  admin_edited: z.number(),
});
export type GlossaryCoverage = z.infer<typeof GlossaryCoverageSchema>;

export const GlossaryListResponseSchema = z.object({
  items:    z.array(GlossaryTermSchema),
  coverage: GlossaryCoverageSchema,
});
export type GlossaryListResponse = z.infer<typeof GlossaryListResponseSchema>;

export const RegenerateResponseSchema = z.object({
  inserted:        z.number(),
  updated:         z.number(),
  preserved_admin: z.number(),
});
export type RegenerateResponse = z.infer<typeof RegenerateResponseSchema>;

export interface GlossaryFilters {
  category?: GlossaryTerm['category'];
  approved?: boolean;
  query?:    string;
}

export const fetchGlossary = (filters: GlossaryFilters = {}) => {
  const params: Record<string, string> = {};
  if (filters.category) params.category = filters.category;
  if (filters.approved !== undefined) params.approved = String(filters.approved);
  if (filters.query) params.query = filters.query;
  return get('/spa/api/ai/glossary', GlossaryListResponseSchema, params);
};

export interface TermInput {
  term:          string;
  definition:    string;
  synonyms?:     string[];
  table_hint?:   string | null;
  column_hint?:  string | null;
  sql_template?: string | null;
  category?:     GlossaryTerm['category'];
  approved?:     boolean;
}

export const createTerm = (body: TermInput) =>
  post('/spa/api/ai/glossary', body, GlossaryTermSchema);

export const updateTerm = async (id: number, patch: Partial<TermInput>) => {
  const { data } = await http.patch(`/spa/api/ai/glossary/${id}`, patch);
  return GlossaryTermSchema.parse(data);
};

export const deleteTerm = (id: number) =>
  del(`/spa/api/ai/glossary/${id}`, z.object({ ok: z.boolean() }));

// Regenerate / reindex are LLM-bound — a local Ollama draft of ~20 terms
// typically takes 30-90s. We bypass the default axios 20s timeout by
// issuing these requests with a per-call override.
export const regenerateGlossary = async (overwrite_auto = true) => {
  const { data } = await http.post(
    '/spa/api/ai/glossary/regenerate',
    { overwrite_auto },
    { timeout: 300_000 },
  );
  return RegenerateResponseSchema.parse(data);
};

export const reindexGlossary = async () => {
  const { data } = await http.post(
    '/spa/api/ai/glossary/reindex',
    {},
    { timeout: 300_000 },
  );
  return z.object({ indexed: z.number() }).parse(data);
};

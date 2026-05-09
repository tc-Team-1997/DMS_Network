import { z } from 'zod';
import { DocumentSchema } from '@/lib/schemas';

// ---------------------------------------------------------------------------
// Search result row — extends DocumentSchema with FTS5 extras
// ---------------------------------------------------------------------------

export const SearchResultSchema = DocumentSchema.extend({
  _score:  z.number().nullable().optional(),
  snippet: z.string().nullable().optional(),
  risk_band: z.string().nullable().optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

// ---------------------------------------------------------------------------
// Facets — one key per active facet field → value → count
// ---------------------------------------------------------------------------

export const FacetBucketSchema = z.record(z.string(), z.number().int());
export const FacetsSchema = z.object({
  doc_type:        FacetBucketSchema.optional(),
  branch:          FacetBucketSchema.optional(),
  risk_band:       FacetBucketSchema.optional(),
  status:          FacetBucketSchema.optional(),
  customer_branch: FacetBucketSchema.optional(),
}).catchall(FacetBucketSchema);
export type Facets = z.infer<typeof FacetsSchema>;

// ---------------------------------------------------------------------------
// Search response envelope
// ---------------------------------------------------------------------------

export const SearchResponseSchema = z.object({
  results:   z.array(SearchResultSchema),
  facets:    FacetsSchema,
  total:     z.number().int(),
  page:      z.number().int(),
  page_size: z.number().int(),
  pages:     z.number().int(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ---------------------------------------------------------------------------
// Search filter state (mirrors GET /spa/api/search params)
// ---------------------------------------------------------------------------

export const ScopeSchema = z.enum(['documents', 'workflows', 'folders', 'recents']);
export type Scope = z.infer<typeof ScopeSchema>;

export const SearchFiltersSchema = z.object({
  q:                   z.string(),
  scope:               ScopeSchema.optional(),
  doc_type:            z.array(z.string()),
  branch:              z.array(z.string()),
  risk_band:           z.array(z.string()),
  status:              z.array(z.string()),
  uploaded_after:      z.string().optional(),
  uploaded_before:     z.string().optional(),
  expiry_within_days:  z.string().optional(),
  customer_cid:        z.string().optional(),
  page:                z.number().int().min(1),
  page_size:           z.number().int().min(1),
});
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const DEFAULT_FILTERS: SearchFilters = {
  q:          '',
  doc_type:   [],
  branch:     [],
  risk_band:  [],
  status:     [],
  page:       1,
  page_size:  20,
};

// ---------------------------------------------------------------------------
// Saved search
// ---------------------------------------------------------------------------

export const SavedSearchScopeSchema = z.enum(['private', 'team', 'tenant']);
export type SavedSearchScope = z.infer<typeof SavedSearchScopeSchema>;

export const SavedSearchSchema = z.object({
  id:          z.number().int(),
  tenant_id:   z.string(),
  user_id:     z.number().int(),
  name:        z.string(),
  query_json:  z.string(),
  scope:       SavedSearchScopeSchema,
  branch:      z.string().nullable(),
  created_at:  z.string(),
  last_run_at: z.string().nullable(),
});
export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export const SavedSearchListSchema = z.array(SavedSearchSchema);

export const CreateSavedSearchBodySchema = z.object({
  name:  z.string().min(1),
  query: z.record(z.string(), z.unknown()),
  scope: SavedSearchScopeSchema,
});
export type CreateSavedSearchBody = z.infer<typeof CreateSavedSearchBodySchema>;

export const OkSchema = z.object({ ok: z.literal(true) });

export const RebuildFtsResponseSchema = z.object({
  ok:     z.literal(true),
  fields: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Cmd-K palette
// ---------------------------------------------------------------------------

export const PaletteItemSchema = z.object({
  type:  z.enum(['document', 'saved_search', 'nav', 'recent']),
  id:    z.union([z.number().int(), z.string()]).optional(),
  label: z.string(),
  meta:  z.string().optional(),
  href:  z.string(),
});
export type PaletteItem = z.infer<typeof PaletteItemSchema>;

export const PaletteGroupSchema = z.object({
  group: z.string(),
  items: z.array(PaletteItemSchema),
});
export type PaletteGroup = z.infer<typeof PaletteGroupSchema>;

export const CmdkResponseSchema = z.object({
  groups: z.array(PaletteGroupSchema),
});
export type CmdkResponse = z.infer<typeof CmdkResponseSchema>;

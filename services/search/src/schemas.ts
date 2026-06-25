import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Boundary validation schemas for the search service.
// These mirror the structural types in @zordms/types but add runtime
// enforcement (parse + 400 on failure) at the mutating endpoints.
// ---------------------------------------------------------------------------

export const SearchModeSchema = z
  .enum(["fulltext", "boolean", "wildcard", "fuzzy", "semantic"])
  .openapi("SearchMode");

export const SearchFiltersSchema = z
  .object({
    doc_type: z.string().optional(),
    status: z.string().optional(),
    branch: z.string().optional(),
    uploaded_by: z.string().optional(),
    risk_band: z.string().optional(),
    legal_hold: z.boolean().optional(),
    expiry_status: z.string().optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
  })
  .openapi("SearchFilters");

export const SearchQuerySchema = z
  .object({
    text: z.string(),
    mode: SearchModeSchema,
    filters: SearchFiltersSchema.optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(5000).optional(),
    sort: z.enum(["relevance", "recent"]).optional(),
  })
  .openapi("SearchQuery");

export const SavedSearchVisibilitySchema = z
  .enum(["private", "public"])
  .openapi("SavedSearchVisibility");

export const SaveSearchRequestSchema = z
  .object({
    name: z.string().min(1),
    query: SearchQuerySchema,
    // visibility defaults to private when omitted/invalid in legacy callers;
    // we accept the optional value and normalize downstream.
    visibility: SavedSearchVisibilitySchema.optional(),
  })
  .openapi("SaveSearchRequest");

export const SearchDocSchema = z
  .object({
    // doc_id presence/non-empty is enforced as a business rule in the route
    // so it can return the specific { error:"invalid_doc" } response.
    doc_id: z.string(),
    ocr_text: z.string().default(""),
    metadata_text: z.string().default(""),
    doc_type: z.string().default(""),
    branch: z.string().default(""),
    status: z.string().default(""),
    risk_band: z.string().default(""),
    legal_hold: z.boolean().default(false),
    expiry_status: z.string().default(""),
    uploaded_by: z.string().default(""),
    indexed_at: z.string().default(""),
  })
  .openapi("SearchDoc");

export const ReindexRequestSchema = z
  .object({
    docs: z.array(SearchDocSchema).default([]),
  })
  .openapi("ReindexRequest");

export const SavedSearchIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi("SavedSearchIdParams");

// ---------------------------------------------------------------------------
// Response / error shapes (for OpenAPI documentation).
// ---------------------------------------------------------------------------

export const ValidationErrorSchema = z
  .object({
    error: z.literal("validation_error"),
    issues: z.array(z.unknown()),
  })
  .openapi("ValidationError");

export const ErrorSchema = z
  .object({
    error: z.string(),
    detail: z.string().optional(),
  })
  .openapi("Error");

export const SearchHitSchema = z
  .object({
    doc_id: z.string(),
    doc_type: z.string(),
    branch: z.string(),
    status: z.string(),
    snippet: z.string(),
    score: z.number(),
    indexed_at: z.string(),
  })
  .openapi("SearchHit");

export const FacetBucketSchema = z
  .object({ value: z.string(), count: z.number() })
  .openapi("FacetBucket");

export const SearchResultsSchema = z
  .object({
    hits: z.array(SearchHitSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    tookMs: z.number(),
    facets: z.record(z.array(FacetBucketSchema)).optional(),
  })
  .openapi("SearchResults");

export const SavedSearchSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    name: z.string(),
    query_json: SearchQuerySchema,
    visibility: SavedSearchVisibilitySchema,
  })
  .openapi("SavedSearch");

export type SearchQueryInput = z.infer<typeof SearchQuerySchema>;
export type SaveSearchRequestInput = z.infer<typeof SaveSearchRequestSchema>;
export type ReindexRequestInput = z.infer<typeof ReindexRequestSchema>;

// ---------------------------------------------------------------------------
// Boundary helper: parse with a schema and on failure send the standard
// 400 { error:"validation_error", issues:[...] } response.
// Returns the parsed value on success, or undefined when a 400 was sent.
// ---------------------------------------------------------------------------
export function parseOrFail<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  res: { status: (n: number) => { json: (b: unknown) => void } },
): z.infer<T> | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({ error: "validation_error", issues: result.error.issues });
    return undefined;
  }
  return result.data;
}

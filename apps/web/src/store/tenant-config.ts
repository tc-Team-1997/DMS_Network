/**
 * SPA hooks for tenant configuration (CC1 + CC3).
 *
 * useTenantConfig(namespace)
 *   React Query wrapper around GET /spa/api/admin/config/:namespace.
 *   staleTime 5 min — config is rare-write; avoid unnecessary refetches.
 *   Only resolves for authenticated Doc Admin users. Other roles will get a
 *   403 from the backend; React Query surfaces it as an error state.
 *
 * useUpdateConfig(namespace)
 *   Mutation wrapper around PUT /spa/api/admin/config/:namespace.
 *   On success, invalidates the namespace cache so the GET re-fetches.
 *
 * useConfigSchema(namespace)  [CC3]
 *   Fetches the JSON Schema for a namespace from
 *   GET /spa/api/admin/config-schema/:namespace.
 *   staleTime Infinity — schemas are static within a deploy.
 *   retry: false — 404 is expected for placeholder namespaces.
 *
 * Zod schemas cover both the request body and the response shape so that
 * any backend drift becomes a typed runtime error.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { get, put } from '@/lib/http';

// ---------------------------------------------------------------------------
// Zod schemas — config map
// ---------------------------------------------------------------------------

/**
 * The config map returned by GET /spa/api/admin/config/:namespace.
 * Keys are config key strings; values are JSON-decoded (unknown at schema level —
 * callers narrow the type for their specific namespace).
 */
export const ConfigMapSchema = z.record(z.string(), z.unknown());
export type ConfigMap = z.infer<typeof ConfigMapSchema>;

/**
 * Request body for PUT /spa/api/admin/config/:namespace.
 */
export const UpdateConfigRequestSchema = z.object({
  key: z.string().min(1, 'key is required'),
  value: z.unknown(),
  reason: z.string().min(20, 'reason must be at least 20 characters'),
});
export type UpdateConfigRequest = z.infer<typeof UpdateConfigRequestSchema>;

/**
 * Response body for PUT /spa/api/admin/config/:namespace.
 */
export const UpdateConfigResponseSchema = z.object({
  tenant_id: z.string(),
  namespace: z.string(),
  key: z.string(),
  value: z.unknown(),
  hash: z.string().length(64),
  changed_at: z.string(),
});
export type UpdateConfigResponse = z.infer<typeof UpdateConfigResponseSchema>;

// ---------------------------------------------------------------------------
// Zod schemas — config schema (CC3)
// ---------------------------------------------------------------------------

/**
 * A single JSON Schema property descriptor (draft-07 subset).
 * Covers the keywords the ConfigPanel form renderer needs.
 * passthrough() so future additions don't break the parser.
 */
export const JsonSchemaPropSchema = z.object({
  type: z.string().optional(),
  enum: z.array(z.string()).optional(),
  format: z.string().optional(),
  pattern: z.string().optional(),
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  description: z.string().optional(),
  // Nested object support (depth ≤ 2 in the renderer).
  properties: z.record(z.string(), z.unknown()).optional(),
  additionalProperties: z.union([z.boolean(), z.unknown()]).optional(),
  items: z.unknown().optional(),
}).passthrough();
export type JsonSchemaProp = z.infer<typeof JsonSchemaPropSchema>;

/**
 * Response from GET /spa/api/admin/config-schema/:namespace.
 */
export const ConfigSchemaResponseSchema = z.object({
  namespace: z.string(),
  schema: z.object({
    type: z.literal('object').optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), z.unknown()]).optional(),
  }).passthrough(),
});
export type ConfigSchemaResponse = z.infer<typeof ConfigSchemaResponseSchema>;

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const tenantConfigKeys = {
  namespace: (namespace: string) => ['tenant-config', namespace] as const,
  schema:    (namespace: string) => ['config-schema', namespace] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Read all keys in a config namespace for the current user's tenant.
 * staleTime: 5 minutes — config changes are rare; avoid polling.
 */
export function useTenantConfig(namespace: string) {
  return useQuery({
    queryKey: tenantConfigKeys.namespace(namespace),
    queryFn: () =>
      get(`/spa/api/admin/config/${encodeURIComponent(namespace)}`, ConfigMapSchema),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Write a single key in a config namespace.
 * Invalidates the namespace cache on success so useTenantConfig re-fetches.
 */
export function useUpdateConfig(namespace: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateConfigRequest) => {
      // Validate request shape at call-site to catch bugs early.
      const parsed = UpdateConfigRequestSchema.parse(body);
      return put(
        `/spa/api/admin/config/${encodeURIComponent(namespace)}`,
        parsed,
        UpdateConfigResponseSchema,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: tenantConfigKeys.namespace(namespace),
      });
    },
  });
}

/**
 * Fetch the JSON Schema for a namespace.
 * staleTime: Infinity — schemas are static within a deploy.
 * retry: false — 404 is expected for placeholder namespaces (ConfigPanel
 *   shows an EmptyState instead of an error when the schema is not yet registered).
 */
export function useConfigSchema(namespace: string) {
  return useQuery({
    queryKey: tenantConfigKeys.schema(namespace),
    queryFn: () =>
      get(
        `/spa/api/admin/config-schema/${encodeURIComponent(namespace)}`,
        ConfigSchemaResponseSchema,
      ),
    staleTime: Infinity,
    retry: false,
  });
}

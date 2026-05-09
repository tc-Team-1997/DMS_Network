/**
 * API layer for admin settings — tenants CRUD.
 *
 * All requests go through src/lib/http.ts with zod schemas.
 * Namespace: /spa/api/admin/tenants/*
 */

import { z } from 'zod';
import { get, post, put } from '@/lib/http';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const TenantRowSchema = z.object({
  tenant_id:         z.string(),
  slug:              z.string(),
  display_name:      z.string(),
  regulator_name:    z.string(),
  regulator_short:   z.string(),
  default_locale:    z.string(),
  allowed_locales:   z.array(z.string()),
  primary_color:     z.string(),
  monogram:          z.string(),
  logo_path:         z.string().nullable(),
  favicon_path:      z.string().nullable(),
  login_banner:      z.string().nullable(),
  footer_text:       z.string().nullable(),
  environment_label: z.string().nullable(),
  is_active:         z.boolean(),
  created_at:        z.string(),
  updated_at:        z.string(),
});
export type TenantRow = z.infer<typeof TenantRowSchema>;

export const TenantsListSchema = z.object({
  tenants: z.array(TenantRowSchema),
});

export const TenantSingleSchema = z.object({
  tenant: TenantRowSchema,
});

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const CreateTenantBodySchema = z.object({
  tenant_id:         z.string().min(1).regex(/^[a-z0-9_-]+$/),
  slug:              z.string().min(1).optional(),
  display_name:      z.string().min(1),
  regulator_name:    z.string().min(1),
  regulator_short:   z.string().min(1).max(20),
  default_locale:    z.string().min(2).optional(),
  allowed_locales:   z.array(z.string()).optional(),
  primary_color:     z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  monogram:          z.string().min(1).max(8).optional(),
  logo_path:         z.string().optional(),
  favicon_path:      z.string().optional(),
  login_banner:      z.string().optional(),
  footer_text:       z.string().optional(),
  environment_label: z.string().optional(),
  is_active:         z.boolean().optional(),
  reason:            z.string().min(20, 'reason must be at least 20 characters'),
});
export type CreateTenantBody = z.infer<typeof CreateTenantBodySchema>;

export const UpdateTenantBodySchema = z.object({
  slug:              z.string().min(1).optional(),
  display_name:      z.string().min(1).optional(),
  regulator_name:    z.string().min(1).optional(),
  regulator_short:   z.string().min(1).max(20).optional(),
  default_locale:    z.string().min(2).optional(),
  allowed_locales:   z.array(z.string()).optional(),
  primary_color:     z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  monogram:          z.string().min(1).max(8).optional(),
  logo_path:         z.string().nullable().optional(),
  favicon_path:      z.string().nullable().optional(),
  login_banner:      z.string().nullable().optional(),
  footer_text:       z.string().nullable().optional(),
  environment_label: z.string().nullable().optional(),
  is_active:         z.boolean().optional(),
  reason:            z.string().min(20, 'reason must be at least 20 characters'),
});
export type UpdateTenantBody = z.infer<typeof UpdateTenantBodySchema>;

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export function fetchTenants(): Promise<TenantRow[]> {
  return get('/spa/api/admin/tenants', TenantsListSchema).then((r) => r.tenants);
}

export function createTenant(body: CreateTenantBody): Promise<TenantRow> {
  const parsed = CreateTenantBodySchema.parse(body);
  return post('/spa/api/admin/tenants', parsed, TenantSingleSchema).then((r) => r.tenant);
}

export function updateTenant(tenantId: string, body: UpdateTenantBody): Promise<TenantRow> {
  const parsed = UpdateTenantBodySchema.parse(body);
  return put(`/spa/api/admin/tenants/${encodeURIComponent(tenantId)}`, parsed, TenantSingleSchema)
    .then((r) => r.tenant);
}

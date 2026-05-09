/**
 * Tenant branding store (CC2).
 *
 * useTenant() returns the resolved Tenant for the logged-in user (or a
 * loading stub until /spa/api/me resolves). Callers must guard on
 * tenant.display_name being truthy before using branding values in effects
 * that have side-effects (document.title, favicon, CSS vars).
 *
 * The store is populated by useAuth.hydrate() in apps/web/src/store/auth.ts,
 * which already fetches /spa/api/me on boot. No extra network call is made.
 *
 * TenantPublicSchema covers the anonymous /spa/api/tenant-public response used
 * by the login page (before the user is authenticated).
 */

import { create } from 'zustand';
import { z } from 'zod';
import { get } from '@/lib/http';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const TenantSchema = z.object({
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
});
export type Tenant = z.infer<typeof TenantSchema>;

export const TenantSummarySchema = z.object({
  tenant_id:    z.string(),
  slug:         z.string(),
  display_name: z.string(),
});
export type TenantSummary = z.infer<typeof TenantSummarySchema>;

/**
 * The full /spa/api/me enriched response.
 * Kept here (not in lib/schemas.ts) because it's tenant-centric and callers
 * import from this module to stay co-located with the schemas.
 */
export const MeWithTenantSchema = z.object({
  user: z.object({
    id:        z.number().int(),
    username:  z.string(),
    full_name: z.string().nullable(),
    role:      z.string(),
    branch:    z.string().nullable(),
    tenant_id: z.string(),
  }),
  tenant:            TenantSchema.nullable(),
  available_tenants: z.array(TenantSummarySchema),
});
export type MeWithTenant = z.infer<typeof MeWithTenantSchema>;

// Used by the login page (anonymous call to /spa/api/tenant-public).
export const TenantPublicSchema = TenantSchema;

// ---------------------------------------------------------------------------
// Loading stub — returned by useTenant() until the real tenant resolves.
// Callers that drive effects (document.title, favicon, CSS vars) MUST check
// tenant.display_name is truthy before acting.
// ---------------------------------------------------------------------------

const LOADING_STUB: Tenant = {
  tenant_id:         '',
  slug:              '',
  display_name:      '',
  regulator_name:    '',
  regulator_short:   '',
  default_locale:    'en',
  allowed_locales:   ['en'],
  primary_color:     '#0D2B6A',
  monogram:          'DM',
  logo_path:         null,
  favicon_path:      null,
  login_banner:      null,
  footer_text:       null,
  environment_label: null,
};

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface TenantState {
  tenant:    Tenant | null;
  available: TenantSummary[];
  setTenant:    (t: Tenant | null) => void;
  setAvailable: (a: TenantSummary[]) => void;
}

export const useTenantStore = create<TenantState>((set) => ({
  tenant:    null,
  available: [],
  setTenant:    (tenant)    => set({ tenant }),
  setAvailable: (available) => set({ available }),
}));

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

/**
 * Returns the resolved Tenant, or the loading stub while /me is in-flight.
 * Never returns null — callers don't need to null-guard; they just check
 * tenant.display_name truthy to distinguish loaded vs. loading.
 */
export function useTenant(): Tenant {
  const tenant = useTenantStore((s) => s.tenant);
  return tenant ?? LOADING_STUB;
}

/**
 * Returns the list of tenants the current user can switch to.
 * Until /me resolves this is []. Currently always [current_tenant] —
 * see Wave B Users-v2 TODO in routes/spa-api/me-switch-tenant.js.
 */
export function useAvailableTenants(): TenantSummary[] {
  return useTenantStore((s) => s.available);
}

// ---------------------------------------------------------------------------
// API helper — used by LoginPage to fetch branding before auth
// ---------------------------------------------------------------------------

export async function fetchTenantPublic(): Promise<Tenant> {
  return get('/spa/api/tenant-public', TenantPublicSchema);
}

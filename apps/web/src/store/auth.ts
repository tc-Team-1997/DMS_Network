import { create } from 'zustand';
import { get, post } from '@/lib/http';
import { LoginResponseSchema, OkSchema, UserSchema, type User } from '@/lib/schemas';
import { MeWithTenantSchema, useTenantStore } from '@/store/tenant';
import { z } from 'zod';

type AuthStatus = 'unknown' | 'authenticated' | 'guest';

interface AuthState {
  user: User | null;
  status: AuthStatus;
  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// The enriched /me response includes tenant + available_tenants (CC2).
// We use a passthrough-extended schema so legacy flat fields (id, username,
// role at top level) still parse correctly alongside the new nested shape.
const MeResponseSchema = z.object({
  // New nested shape (CC2).
  user:              UserSchema.nullable().optional(),
  tenant:            MeWithTenantSchema.shape.tenant.optional(),
  available_tenants: MeWithTenantSchema.shape.available_tenants.optional(),
  // Legacy flat fields — kept for backward compat; mirrored in the Node handler.
  id:        z.number().int().optional(),
  username:  z.string().optional(),
  role:      z.string().optional(),
  full_name: z.string().nullable().optional(),
  fullName:  z.string().nullable().optional(),
  branch:    z.string().nullable().optional(),
  tenant_id: z.string().optional(),
});

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'unknown',

  hydrate: async () => {
    try {
      const data = await get('/spa/api/me', MeResponseSchema);

      // Resolve the User object: prefer the nested `user` field (CC2 shape),
      // fall back to constructing from legacy flat fields for old server builds.
      const rawUser = data.user ?? (data.id != null ? {
        id:        data.id,
        username:  data.username ?? '',
        full_name: data.full_name ?? data.fullName ?? null,
        role:      data.role ?? 'Viewer',
        branch:    data.branch ?? null,
        tenant_id: data.tenant_id ?? 'nbe',
      } : null);

      const userResult = rawUser ? UserSchema.safeParse(rawUser) : null;
      const user: User | null = userResult?.success ? userResult.data : null;

      set({ user, status: user ? 'authenticated' : 'guest' });

      // Populate the tenant store so chrome components (Sidebar, Topbar,
      // AppLayout) pick up branding without an extra network call.
      if (data.tenant) {
        useTenantStore.getState().setTenant(data.tenant);
      }
      if (data.available_tenants) {
        useTenantStore.getState().setAvailable(data.available_tenants);
      }
    } catch {
      set({ user: null, status: 'guest' });
    }
  },

  login: async (username, password) => {
    const { user } = await post('/spa/api/login', { username, password }, LoginResponseSchema);
    set({ user, status: 'authenticated' });
    // After login, re-hydrate to get the tenant payload.
    await useAuth.getState().hydrate();
  },

  logout: async () => {
    await post('/spa/api/logout', {}, OkSchema);
    // Clear tenant store on logout.
    useTenantStore.getState().setTenant(null);
    useTenantStore.getState().setAvailable([]);
    set({ user: null, status: 'guest' });
  },
}));

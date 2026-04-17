import { create } from 'zustand';
import { get, post } from '@/lib/http';
import { LoginResponseSchema, OkSchema, UserSchema, type User } from '@/lib/schemas';
import { z } from 'zod';

type AuthStatus = 'unknown' | 'authenticated' | 'guest';

interface AuthState {
  user: User | null;
  status: AuthStatus;
  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const MeResponseSchema = z.object({ user: UserSchema.nullable() });

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'unknown',

  hydrate: async () => {
    try {
      const { user } = await get('/spa/api/me', MeResponseSchema);
      set({ user, status: user ? 'authenticated' : 'guest' });
    } catch {
      set({ user: null, status: 'guest' });
    }
  },

  login: async (username, password) => {
    const { user } = await post('/spa/api/login', { username, password }, LoginResponseSchema);
    set({ user, status: 'authenticated' });
  },

  logout: async () => {
    await post('/spa/api/logout', {}, OkSchema);
    set({ user: null, status: 'guest' });
  },
}));

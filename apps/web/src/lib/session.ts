import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/http';

// ── Schemas ───────────────────────────────────────────────────────────────────

const SessionUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  role: z.string(),
  tenant_id: z.string(),
});

const SessionInfoSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  seconds_remaining: z.number(),
  last_active_at: z.string(),
  can_extend: z.boolean(),
  warning_threshold: z.number(),
});

const SessionStatusAuthenticatedSchema = z.object({
  authenticated: z.literal(true),
  user: SessionUserSchema,
  session: SessionInfoSchema,
});

const SessionStatusUnauthenticatedSchema = z.object({
  authenticated: z.literal(false),
  warning_seconds_threshold: z.number(),
});

export const SessionStatusSchema = z.discriminatedUnion('authenticated', [
  SessionStatusAuthenticatedSchema,
  SessionStatusUnauthenticatedSchema,
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type SessionStatusAuthenticated = z.infer<typeof SessionStatusAuthenticatedSchema>;

const SESSION_STATUS_URL = '/spa/api/auth/session-status';
const EXTEND_SESSION_URL = '/spa/api/auth/extend-session';
const LOGOUT_SESSION_URL = '/spa/api/auth/logout';

// ── API functions ─────────────────────────────────────────────────────────────

export async function fetchSessionStatus(): Promise<SessionStatus> {
  return get(SESSION_STATUS_URL, SessionStatusSchema);
}

export async function extendSession(): Promise<SessionStatus> {
  return post(EXTEND_SESSION_URL, {}, SessionStatusSchema);
}

export async function logoutSession(): Promise<void> {
  const LogoutSchema = z.object({ ok: z.literal(true) });
  await post(LOGOUT_SESSION_URL, {}, LogoutSchema);
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}`);
}

// ── Query key ─────────────────────────────────────────────────────────────────

export const SESSION_QUERY_KEY = ['session-status'] as const;

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Single source of truth for session polling.
 * - Normal: 30 s interval.
 * - Warning zone (seconds_remaining <= warning_threshold): 5 s interval.
 * - Critical zone (seconds_remaining <= 60): 1 s interval.
 * Minimum interval: 1 s (prevents runaway refetches).
 */
export function useSessionStatus() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSessionStatus,
    refetchIntervalInBackground: true,
    // Interval is computed dynamically from the cached data.
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data?.authenticated) return 30_000;
      const { seconds_remaining, warning_threshold } = data.session;
      if (seconds_remaining <= 60) return 1_000;
      if (seconds_remaining <= warning_threshold) return 5_000;
      return 30_000;
    },
    staleTime: 0,
  });

  const extendMutation = useMutation({
    mutationFn: extendSession,
    onSuccess: (fresh) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, fresh);
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    refetch: query.refetch,
    extend: extendMutation.mutate,
    isExtending: extendMutation.isPending,
  };
}

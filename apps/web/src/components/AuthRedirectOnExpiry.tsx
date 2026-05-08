import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSessionStatus } from '@/lib/session';

/**
 * No-UI component. Watches the session-status poll and redirects to /login
 * when authenticated flips from true → false (server-side expiry or logout
 * by another tab).
 *
 * The 401-interceptor in http.ts covers mid-request expiry; this covers the
 * polling heartbeat case where the server has already invalidated the session.
 */
export function AuthRedirectOnExpiry() {
  const { data } = useSessionStatus();
  const location = useLocation();
  // Track previous authenticated state so we only act on the transition.
  const prevAuthenticatedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (data === undefined) return;
    const isAuthenticated = data.authenticated;
    const prev = prevAuthenticatedRef.current;

    if (prev === true && isAuthenticated === false) {
      // Authenticated → unauthenticated transition: redirect.
      const next = encodeURIComponent(location.pathname + location.search);
      window.location.assign(`/login?next=${next}`);
    }

    prevAuthenticatedRef.current = isAuthenticated;
  }, [data, location.pathname, location.search]);

  return null;
}

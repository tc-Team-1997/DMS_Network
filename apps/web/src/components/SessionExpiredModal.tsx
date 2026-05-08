import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useSessionStatus, logoutSession } from '@/lib/session';
import { ShieldAlert } from 'lucide-react';

function formatMmSs(secs: number): string {
  const clamped = Math.max(0, Math.round(secs));
  const mm = Math.floor(clamped / 60).toString().padStart(2, '0');
  const ss = (clamped % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Blocking modal shown when seconds_remaining <= 60 (and > 0).
 * Auto-redirects on expiry. Cannot be dismissed.
 */
export function SessionExpiredModal() {
  const { data, extend, isExtending, refetch } = useSessionStatus();
  const location = useLocation();
  const titleId = useId();
  const descId = useId();

  // Live countdown from expires_at — 1 s ticks.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const redirectedRef = useRef(false);

  const computeSecondsLeft = useCallback((): number | null => {
    if (!data?.authenticated) return null;
    const expiresAt = new Date(data.session.expires_at).getTime();
    return Math.max(0, (expiresAt - Date.now()) / 1000);
  }, [data]);

  useEffect(() => {
    setSecondsLeft(computeSecondsLeft());
    const interval = setInterval(() => {
      const secs = computeSecondsLeft();
      setSecondsLeft(secs);

      // Auto-logout when the computed clock hits 0.
      if (secs !== null && secs <= 0 && !redirectedRef.current) {
        redirectedRef.current = true;
        const next = encodeURIComponent(location.pathname + location.search);
        window.location.assign(`/login?next=${next}`);
      }
    }, 1_000);
    return () => clearInterval(interval);
  }, [computeSecondsLeft, location.pathname, location.search]);

  // If server reports not authenticated, redirect immediately.
  useEffect(() => {
    if (data !== undefined && !data.authenticated && !redirectedRef.current) {
      redirectedRef.current = true;
      const next = encodeURIComponent(location.pathname + location.search);
      window.location.assign(`/login?next=${next}`);
    }
  }, [data, location.pathname, location.search]);

  const handleExtend = () => {
    extend(undefined, {
      onSuccess: () => {
        void refetch();
      },
    });
  };

  const handleLogout = () => {
    void logoutSession();
  };

  if (!data?.authenticated) return null;

  const secs = secondsLeft ?? data.session.seconds_remaining;

  // Show modal only in the critical zone: <= 60 s and > 0
  if (secs > 60 || secs <= 0) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-testid="session-expired-modal"
    >
      {/* Panel */}
      <div className="w-full max-w-sm rounded-card bg-surface shadow-xl ring-1 ring-border p-6 flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-danger-bg flex items-center justify-center">
          <ShieldAlert size={22} className="text-danger" />
        </div>

        <div className="text-center space-y-1">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            Session expiring soon
          </h2>
          <p id={descId} className="text-sm text-sub">
            Your session will expire in
          </p>
        </div>

        {/* Countdown */}
        <div
          aria-live="assertive"
          aria-atomic="true"
          className="text-4xl font-mono font-bold tracking-widest text-danger"
        >
          {formatMmSs(secs)}
        </div>

        <div className="flex w-full gap-3">
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleExtend}
            disabled={isExtending || !data.session.can_extend}
            loading={isExtending}
          >
            Extend session
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            onClick={handleLogout}
          >
            Log out now
          </Button>
        </div>
      </div>
    </div>
  );
}

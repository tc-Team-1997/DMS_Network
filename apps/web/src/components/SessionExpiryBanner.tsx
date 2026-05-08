import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { useSessionStatus, logoutSession } from '@/lib/session';
import { AlertTriangle } from 'lucide-react';

/**
 * Sticky banner shown when session is in the warning zone:
 *   authenticated && seconds_remaining <= warning_threshold && seconds_remaining > 60
 * Ticks down client-side every 15 s from expires_at so the minute count
 * stays accurate between polls.
 */
export function SessionExpiryBanner() {
  const { data, refetch, extend, isExtending } = useSessionStatus();

  // Client-side countdown derived from expires_at, updated every 15 s.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const computeSecondsLeft = useCallback((): number | null => {
    if (!data?.authenticated) return null;
    const expiresAt = new Date(data.session.expires_at).getTime();
    return Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  }, [data]);

  useEffect(() => {
    const secs = computeSecondsLeft();
    setSecondsLeft(secs);
    const interval = setInterval(() => {
      setSecondsLeft(computeSecondsLeft());
    }, 15_000);
    return () => clearInterval(interval);
  }, [computeSecondsLeft]);

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

  const threshold = data.session.warning_threshold;
  const secs = secondsLeft ?? data.session.seconds_remaining;

  // Show banner only in the warning window: > 60 s and <= threshold
  if (secs <= 60 || secs > threshold) return null;

  const minutesDisplay = Math.ceil(secs / 60);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Session expiry warning"
      data-testid="session-expiry-banner"
      className="sticky top-0 z-40 flex items-center gap-3 bg-warning-bg border-b border-warning/30 px-4 py-2.5 text-sm"
    >
      <AlertTriangle size={16} className="text-warning shrink-0" />
      <span className="flex-1 text-ink">
        Your session expires in{' '}
        <strong className="text-warning">
          {minutesDisplay} {minutesDisplay === 1 ? 'minute' : 'minutes'}
        </strong>.
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="primary"
          onClick={handleExtend}
          disabled={isExtending || !data.session.can_extend}
          loading={isExtending}
        >
          Extend session
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleLogout}
        >
          Log out
        </Button>
      </div>
    </div>
  );
}

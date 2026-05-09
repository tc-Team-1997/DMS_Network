/**
 * WormBadge — read-only WORM lock status pill.
 *
 * Rendered next to document rows in the Repository table and in the Viewer
 * page header. Shows Locked / Unlocked / Tampered with a padlock icon.
 *
 * Tooltip on hover shows:
 *   - Lock date (locked_at)
 *   - Unlock-after date (unlock_after)
 *   - Tampered boolean (NOT raw SHA-256 hashes — forensic data)
 *
 * A11y:
 *   - aria-label describes state including unlock date (WCAG 2.1 AA)
 *   - role="status" on the tamper alert so screen readers announce it
 *   - No animations (reduced-motion-safe by design)
 *   - Color contrast ≥ 3:1 (danger/success tokens)
 */

import { useQuery } from '@tanstack/react-query';
import { Lock, LockOpen, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchWormStatus, FF_WORM } from '../api';

interface WormBadgeProps {
  /** Document ID to fetch WORM status for. */
  documentId: number;
  /** Extra CSS classes to apply to the wrapper. */
  className?: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function WormBadge({ documentId, className }: WormBadgeProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['worm', 'status', documentId],
    queryFn: () => fetchWormStatus(documentId),
    // Only poll when the feature flag is on
    enabled: FF_WORM,
    // Status rarely changes; 2-minute stale time keeps the badge fresh
    // without hammering the API on every re-render.
    staleTime: 2 * 60 * 1000,
  });

  // Feature flag off — render nothing
  if (!FF_WORM) return null;

  if (isLoading) {
    return (
      <span className={cn('inline-block text-xs text-muted animate-pulse', className)}>
        {t('worm.loading')}
      </span>
    );
  }

  if (isError || !data) return null;

  // ── Tampered state (highest priority) ───────────────────────────────────────
  if (data.tampered) {
    const label = t('worm.status_tampered');
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <Badge
          tone="danger"
          data-testid={`worm-badge-${documentId}`}
          role="status"
          aria-label={label}
        >
          <ShieldAlert size={10} aria-hidden="true" className="inline" />
          {' '}{label}
        </Badge>
        {/* Separate accessible alert element for screen reader announcement */}
        <span
          className="sr-only"
          role="alert"
          data-testid="worm-status-tampered"
        >
          {t('worm.tamper_alert_sr')}
        </span>
      </span>
    );
  }

  // ── Locked state ─────────────────────────────────────────────────────────────
  if (data.worm_locked) {
    const unlockDateStr = data.unlock_after ? formatDate(data.unlock_after) : '—';
    const lockedDateStr = data.locked_at ? formatDate(data.locked_at) : '—';
    const ariaLabel = t('worm.locked_aria', { date: unlockDateStr });

    return (
      <span
        className={cn('relative inline-flex items-center group', className)}
        data-testid={`worm-badge-${documentId}`}
      >
        <Badge
          tone="danger"
          aria-label={ariaLabel}
          className="inline-flex items-center gap-1 cursor-default"
        >
          <Lock size={10} aria-hidden="true" className="inline" />
          {' '}{t('worm.status_locked')}
        </Badge>

        {/* Hover tooltip — positioned above using CSS group hover */}
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2',
            'z-50 w-max max-w-[200px] rounded-input border border-border',
            'bg-surface shadow-card px-3 py-2 text-xs text-ink',
            'opacity-0 group-hover:opacity-100 transition-opacity',
          )}
        >
          <div className="space-y-0.5">
            <div>
              <span className="text-muted">{t('worm.tooltip_locked_at')}: </span>
              {lockedDateStr}
            </div>
            <div>
              <span className="text-muted">{t('worm.tooltip_unlock_after')}: </span>
              {unlockDateStr}
            </div>
          </div>
        </span>
      </span>
    );
  }

  // ── Unlocked state ────────────────────────────────────────────────────────────
  return (
    <span
      className={cn('inline-flex items-center', className)}
      data-testid={`worm-badge-${documentId}`}
    >
      <Badge
        tone="neutral"
        aria-label={t('worm.status_unlocked')}
        className="inline-flex items-center gap-1 cursor-default"
      >
        <LockOpen size={10} aria-hidden="true" className="inline" />
        {' '}{t('worm.status_unlocked')}
      </Badge>
    </span>
  );
}

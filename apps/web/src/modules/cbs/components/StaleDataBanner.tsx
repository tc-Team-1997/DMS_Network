/**
 * StaleDataBanner — amber informational banner shown when CBS data is stale
 * (CBS upstream is unavailable and the response came from the 5-min cache).
 *
 * A11y: aria-live="polite" so screen readers announce the stale state when
 * it appears. Uses both colour and an icon (no colour-only signal).
 */

import { AlertTriangle } from 'lucide-react';
import { t } from '@/lib/i18n';

interface StaleDataBannerProps {
  /** ISO timestamp from `cached_at` field in the customer response. */
  since: string;
}

function relativeTime(isoTimestamp: string): string {
  try {
    const delta = Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    return `${Math.floor(delta / 3600)}h ago`;
  } catch {
    return isoTimestamp;
  }
}

export function StaleDataBanner({ since }: StaleDataBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="cbs-stale-banner"
      className="flex items-start gap-2 rounded-input border border-warning/40 bg-warning/10 px-3 py-2"
    >
      <AlertTriangle
        size={14}
        className="mt-0.5 shrink-0 text-warning"
        aria-hidden="true"
      />
      <p className="text-xs text-warning leading-snug">
        {t('cbs.stale_banner_prefix')}{' '}
        <span className="font-semibold">{relativeTime(since)}</span>
        {' '}{t('cbs.stale_banner_suffix')}
      </p>
    </div>
  );
}
